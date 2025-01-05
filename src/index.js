import { Client, GatewayIntentBits } from "discord.js";
import * as dotenv from "dotenv";
import { debounce } from "lodash-es";

import { Logger } from "./utils/logger.js";
import {
  handleClassSelection,
  ensureClassRoleEmbed,
  setupWeaponRoleEnforcement,
} from "./weaponRoles.js";
import {
  handleRoleOperation,
  syncRoleToSlaveServers,
  initialBanSync,
  setupBanHandlers,
  retryOperation,
} from "./roleSync.js";
import {
  SERVER_CONFIG,
  GUILD_ROLES,
  ROLE_PAIRS,
  RETRY_CONFIG,
} from "./config.js";

dotenv.config();

// Validate environment and configuration
function validateEnvironment() {
  const requiredEnvVars = ["TOKEN", "DRY_RUN"];
  const missingVars = requiredEnvVars.filter(
    (varName) => !process.env[varName]
  );

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(", ")}`
    );
  }
}

// Validate server configuration
async function validateServerConfig(client) {
  try {
    // Validate main server
    const mainGuild = await client.guilds.fetch(SERVER_CONFIG.MAIN_SERVER_ID);
    if (!mainGuild) {
      throw new Error("Main server not found");
    }

    // Validate main server roles
    const mainMemberRole = await mainGuild.roles.fetch(
      SERVER_CONFIG.MAIN_MEMBER_ROLE_ID
    );
    const pendingRole = await mainGuild.roles.fetch(
      SERVER_CONFIG.PENDING_ROLE_ID
    );

    if (!mainMemberRole || !pendingRole) {
      throw new Error("Required roles not found in main server");
    }

    // Validate guild roles
    for (const [guildKey, guildData] of Object.entries(GUILD_ROLES)) {
      const role = await mainGuild.roles.fetch(guildData.id);
      if (!role) {
        throw new Error(`Guild role ${guildKey} (${guildData.id}) not found`);
      }
    }

    Logger.info("Server configuration validated successfully");
  } catch (error) {
    Logger.error(`Server configuration validation failed: ${error}`);
    throw error;
  }
}

// Initialize the client with required intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

const DRY_RUN = process.env.DRY_RUN === "true";
const processedOperations = new Set();

// Startup sequence
client.once("ready", async () => {
  try {
    Logger.info(`Bot logged in as ${client.user.tag}`);

    // Validate environment and configuration
    validateEnvironment();
    await validateServerConfig(client);

    if (DRY_RUN) {
      Logger.info("Running in DRY RUN mode");
    }

    // Initialize bot systems
    await setupRoleSync(client);
    await initialBanSync(
      client,
      SERVER_CONFIG.MAIN_SERVER_ID,
      ROLE_PAIRS,
      DRY_RUN
    );
    await initialSync(client);
    await ensureClassRoleEmbed(client, SERVER_CONFIG.ROLE_SELECTION_CHANNEL_ID);
    setupWeaponRoleEnforcement(client);

    Logger.info("Bot initialization completed successfully");
  } catch (error) {
    Logger.error(`Bot initialization failed: ${error}`);
    process.exit(1); // Exit if initialization fails
  }
});

async function hasGuildRole(member) {
  return Object.keys(ROLE_PAIRS).some((roleId) =>
    member.roles.cache.has(roleId)
  );
}

async function removeUnauthorizedRoles(slaveGuild, mainMember, rolePairs) {
  const slaveServerId = slaveGuild.id;
  const slaveMember = await slaveGuild.members
    .fetch(mainMember.id)
    .catch(() => null);
  if (!slaveMember) return;

  const relevantRolePairs = Object.entries(rolePairs).filter(([_, servers]) =>
    Object.keys(servers).includes(slaveServerId)
  );

  for (const [mainRoleId, slaveServers] of relevantRolePairs) {
    const slaveRoleId = slaveServers[slaveServerId];
    if (!slaveRoleId) continue;

    if (
      slaveMember.roles.cache.has(slaveRoleId) &&
      !mainMember.roles.cache.has(mainRoleId)
    ) {
      await handleRoleOperation(
        slaveMember,
        slaveRoleId,
        "remove",
        "Removed unauthorized role from",
        DRY_RUN
      );
    }
  }
}

async function syncRoleAdd(client, member, mainRoleId) {
  Logger.sync(`Starting role sync for ${member.user.username}`);
  try {
    // Log the role being synced
    Logger.sync(`Syncing role ${mainRoleId} for ${member.user.username}`);
    Logger.sync(
      `Role pairs available: ${JSON.stringify(ROLE_PAIRS[mainRoleId])}`
    );

    await removeOtherGuildRoles(member, mainRoleId);

    if (!member.roles.cache.has(SERVER_CONFIG.MAIN_MEMBER_ROLE_ID)) {
      await handleRoleOperation(
        member,
        SERVER_CONFIG.MAIN_MEMBER_ROLE_ID,
        "add",
        "Added main member role to",
        DRY_RUN
      );
    }

    await removePendingRole(client, member);

    // Ensure the role sync operation is called with all necessary parameters
    await syncRoleToSlaveServers(
      client,
      member,
      mainRoleId,
      "add",
      ROLE_PAIRS,
      processedOperations,
      DRY_RUN
    );

    Logger.sync(`Completed role sync for ${member.user.username}`);
  } catch (error) {
    Logger.error(`Role sync failed for ${member.user.username}: ${error}`);
    throw error;
  }
}

async function syncRoleRemove(client, member, mainRoleId) {
  Logger.sync(`Starting role removal for ${member.user.username}`);
  try {
    const hasOtherGuildRoles = Object.values(GUILD_ROLES).some(
      (role) => member.roles.cache.has(role.id) && role.id !== mainRoleId
    );

    if (
      !hasOtherGuildRoles &&
      member.roles.cache.has(SERVER_CONFIG.MAIN_MEMBER_ROLE_ID)
    ) {
      await handleRoleOperation(
        member,
        SERVER_CONFIG.MAIN_MEMBER_ROLE_ID,
        "remove",
        "Removed main member role from",
        DRY_RUN
      );
    }
    await syncRoleToSlaveServers(
      client,
      member,
      mainRoleId,
      "remove",
      ROLE_PAIRS,
      processedOperations,
      DRY_RUN
    );
  } catch (error) {
    Logger.error(`Role removal failed for ${member.user.username}: ${error}`);
    throw error;
  }
}

async function removeOtherGuildRoles(member, mainRoleId) {
  const otherGuildRoles = Object.values(GUILD_ROLES)
    .map((r) => r.id)
    .filter((id) => id !== mainRoleId);

  for (const roleId of otherGuildRoles) {
    if (member.roles.cache.has(roleId)) {
      await handleRoleOperation(
        member,
        roleId,
        "remove",
        "Removed guild role from",
        DRY_RUN
      );
      await syncRoleRemove(client, member, roleId);
    }
  }
}

async function removePendingRole(client, member) {
  const mainGuild = await client.guilds.fetch(SERVER_CONFIG.MAIN_SERVER_ID);
  const mainMember = await mainGuild.members.fetch(member.id).catch(() => null);
  if (mainMember?.roles.cache.has(SERVER_CONFIG.PENDING_ROLE_ID)) {
    await handleRoleOperation(
      mainMember,
      SERVER_CONFIG.PENDING_ROLE_ID,
      "remove",
      "Removed pending role from",
      DRY_RUN
    );
  }
}

// Debounced member update handlers
const debouncedMemberUpdate = debounce(async (oldMember, newMember) => {
  const isMainServer = newMember.guild.id === SERVER_CONFIG.MAIN_SERVER_ID;

  if (isMainServer) {
    const addedGuildRoles = newMember.roles.cache.filter(
      (role) => !oldMember.roles.cache.has(role.id) && ROLE_PAIRS[role.id]
    );

    const removedGuildRoles = oldMember.roles.cache.filter(
      (role) => !newMember.roles.cache.has(role.id) && ROLE_PAIRS[role.id]
    );

    const memberRoleRemoved =
      oldMember.roles.cache.has(SERVER_CONFIG.MAIN_MEMBER_ROLE_ID) &&
      !newMember.roles.cache.has(SERVER_CONFIG.MAIN_MEMBER_ROLE_ID);

    const pendingRoleAdded =
      !oldMember.roles.cache.has(SERVER_CONFIG.PENDING_ROLE_ID) &&
      newMember.roles.cache.has(SERVER_CONFIG.PENDING_ROLE_ID);

    if (addedGuildRoles.size > 0) {
      for (const [_, role] of addedGuildRoles) {
        await retryOperation(() => syncRoleAdd(client, newMember, role.id));
      }
    }

    if (removedGuildRoles.size > 0) {
      for (const [_, role] of removedGuildRoles) {
        await retryOperation(() => syncRoleRemove(client, newMember, role.id));
      }
    }

    if (memberRoleRemoved && (await hasGuildRole(newMember))) {
      await handleRoleOperation(
        newMember,
        SERVER_CONFIG.MAIN_MEMBER_ROLE_ID,
        "add",
        "Restored main member role to",
        DRY_RUN
      );
    }

    if (pendingRoleAdded && (await hasGuildRole(newMember))) {
      await handleRoleOperation(
        newMember,
        SERVER_CONFIG.PENDING_ROLE_ID,
        "remove",
        "Removed pending role from",
        DRY_RUN
      );
    }
  } else {
    await handleSlaveServerUpdate(oldMember, newMember);
  }
}, RETRY_CONFIG.OPERATION_TIMEOUT);

const debouncedMemberAdd = debounce(async (member) => {
  if (member.guild.id === SERVER_CONFIG.MAIN_SERVER_ID) {
    const hasGuildRole = Object.values(GUILD_ROLES).some((role) =>
      member.roles.cache.has(role.id)
    );
    if (
      hasGuildRole &&
      !member.roles.cache.has(SERVER_CONFIG.MAIN_MEMBER_ROLE_ID) &&
      !DRY_RUN
    ) {
      await handleRoleOperation(
        member,
        SERVER_CONFIG.MAIN_MEMBER_ROLE_ID,
        "add",
        "Added main member role to",
        DRY_RUN
      );
    }
    return;
  }

  await handleSlaveServerMemberAdd(member);
}, RETRY_CONFIG.OPERATION_TIMEOUT);

// Helper function for slave server member updates
async function handleSlaveServerUpdate(oldMember, newMember) {
  const slaveServerId = newMember.guild.id;
  const mainRoleConfigs = Object.entries(ROLE_PAIRS).filter(([_, servers]) =>
    Object.keys(servers).includes(slaveServerId)
  );

  if (mainRoleConfigs.length === 0) return;

  const mainGuild = await client.guilds.fetch(SERVER_CONFIG.MAIN_SERVER_ID);
  const mainMember = await mainGuild.members
    .fetch(newMember.id)
    .catch(() => null);
  if (!mainMember) return;

  for (const [mainRoleId, slaveServers] of mainRoleConfigs) {
    const slaveRoleId = slaveServers[slaveServerId];
    const hadRole = oldMember.roles.cache.has(slaveRoleId);
    const hasRole = newMember.roles.cache.has(slaveRoleId);

    if (hadRole === hasRole) continue;

    if (!mainMember.roles.cache.has(mainRoleId) && hasRole) {
      Logger.warn(
        `Unauthorized role addition detected in ${newMember.guild.name}`
      );
      if (!DRY_RUN) {
        await handleRoleOperation(
          newMember,
          slaveRoleId,
          "remove",
          "Removed unauthorized role from",
          DRY_RUN
        );
      }
    }

    if (mainMember.roles.cache.has(mainRoleId) && !hasRole) {
      Logger.warn(
        `Unauthorized role removal detected in ${newMember.guild.name}`
      );
      if (!DRY_RUN) {
        await handleRoleOperation(
          newMember,
          slaveRoleId,
          "add",
          "Restored authorized role to",
          DRY_RUN
        );
      }
    }
  }
}

// Helper function for slave server member adds
async function handleSlaveServerMemberAdd(member) {
  const mainGuild = await client.guilds.fetch(SERVER_CONFIG.MAIN_SERVER_ID);
  const mainMember = await mainGuild.members.fetch(member.id).catch(() => null);
  if (!mainMember) return;

  for (const [mainRoleId, slaveServers] of Object.entries(ROLE_PAIRS)) {
    const slaveRoleId = slaveServers[member.guild.id];
    if (!slaveRoleId) continue;

    if (mainMember.roles.cache.has(mainRoleId)) {
      await handleRoleOperation(
        member,
        slaveRoleId,
        "add",
        "Added role to new member",
        DRY_RUN
      );
    }
  }
}

function setupRoleSync(client) {
  if (DRY_RUN) Logger.info("Running in DRY RUN mode");

  client.on("guildMemberUpdate", async (oldMember, newMember) => {
    try {
      await debouncedMemberUpdate(oldMember, newMember);
    } catch (error) {
      Logger.error(`Failed to handle member update: ${error}`);
    }
  });

  client.on("guildMemberAdd", async (member) => {
    try {
      await debouncedMemberAdd(member);
    } catch (error) {
      Logger.error(`Failed to handle member add: ${error}`);
    }
  });
}

async function initialSync(client) {
  Logger.info(`Starting initial sync (${DRY_RUN ? "DRY RUN" : "LIVE"})`);

  try {
    const mainGuild = await client.guilds.fetch(SERVER_CONFIG.MAIN_SERVER_ID);
    if (!mainGuild) {
      Logger.error("Main guild not found during initial sync");
      return;
    }

    // Get all slave server IDs in one go
    const slaveServerIds = new Set();
    Object.values(ROLE_PAIRS).forEach((servers) => {
      Object.keys(servers).forEach((serverId) => slaveServerIds.add(serverId));
    });

    // Create a map of role pairs for faster lookups
    const rolePairsMap = new Map();
    Object.entries(ROLE_PAIRS).forEach(([mainRoleId, servers]) => {
      Object.entries(servers).forEach(([serverId, slaveRoleId]) => {
        if (!rolePairsMap.has(serverId)) {
          rolePairsMap.set(serverId, new Map());
        }
        rolePairsMap.get(serverId).set(mainRoleId, slaveRoleId);
      });
    });

    // Process each slave server
    const serverPromises = Array.from(slaveServerIds).map(
      async (slaveServerId) => {
        try {
          const slaveGuild = await client.guilds.fetch(slaveServerId);
          Logger.info(`Processing slave server: ${slaveGuild.name}`);

          // Get all members in one fetch
          const members = await slaveGuild.members.fetch();
          if (!members?.size) {
            Logger.warn(`No members found in ${slaveGuild.name}`);
            return;
          }

          // Get role pairs for this server
          const serverRolePairs = rolePairsMap.get(slaveServerId);
          if (!serverRolePairs?.size) {
            Logger.warn(`No role pairs found for ${slaveGuild.name}`);
            return;
          }

          // Process members in chunks to avoid rate limits
          const memberChunks = Array.from(members.values()).reduce(
            (chunks, member) => {
              if (
                !chunks[chunks.length - 1] ||
                chunks[chunks.length - 1].length >= 10
              ) {
                chunks.push([]);
              }
              chunks[chunks.length - 1].push(member);
              return chunks;
            },
            [[]]
          );

          for (const memberChunk of memberChunks) {
            await Promise.all(
              memberChunk.map(async (slaveMember) => {
                try {
                  const mainMember = await mainGuild.members
                    .fetch(slaveMember.id)
                    .catch(() => null);
                  if (!mainMember) return;

                  // Check and remove unauthorized roles
                  const rolesToRemove = [];
                  serverRolePairs.forEach((slaveRoleId, mainRoleId) => {
                    if (
                      slaveMember.roles.cache.has(slaveRoleId) &&
                      !mainMember.roles.cache.has(mainRoleId)
                    ) {
                      rolesToRemove.push(slaveRoleId);
                    }
                  });

                  // Check and add missing authorized roles
                  const rolesToAdd = [];
                  serverRolePairs.forEach((slaveRoleId, mainRoleId) => {
                    if (
                      !slaveMember.roles.cache.has(slaveRoleId) &&
                      mainMember.roles.cache.has(mainRoleId)
                    ) {
                      rolesToAdd.push(slaveRoleId);
                    }
                  });

                  // Apply role changes
                  if (rolesToRemove.length > 0) {
                    Logger.info(
                      `Removing ${rolesToRemove.length} unauthorized roles from ${slaveMember.user.username} in ${slaveGuild.name}`
                    );
                    if (!DRY_RUN) {
                      await Promise.all(
                        rolesToRemove.map((roleId) =>
                          handleRoleOperation(
                            slaveMember,
                            roleId,
                            "remove",
                            "Removed unauthorized role from",
                            DRY_RUN
                          )
                        )
                      );
                    }
                  }

                  if (rolesToAdd.length > 0) {
                    Logger.info(
                      `Adding ${rolesToAdd.length} authorized roles to ${slaveMember.user.username} in ${slaveGuild.name}`
                    );
                    if (!DRY_RUN) {
                      await Promise.all(
                        rolesToAdd.map((roleId) =>
                          handleRoleOperation(
                            slaveMember,
                            roleId,
                            "add",
                            "Added authorized role to",
                            DRY_RUN
                          )
                        )
                      );
                    }
                  }
                } catch (error) {
                  Logger.error(
                    `Failed to process member ${slaveMember.user.username} in ${slaveGuild.name}: ${error}`
                  );
                }
              })
            );

            // Add a small delay between chunks to avoid rate limits
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }

          Logger.info(`Completed processing ${slaveGuild.name}`);
        } catch (error) {
          Logger.error(
            `Failed to process slave server ${slaveServerId}: ${error}`
          );
        }
      }
    );

    await Promise.all(serverPromises);
    Logger.info("Initial sync completed successfully");
  } catch (error) {
    Logger.error(`Initial sync failed: ${error}`);
  }
}

// Update event handlers to use improved error handling
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;

  try {
    await handleClassSelection(interaction);
  } catch (error) {
    Logger.error(`Failed to handle interaction: ${error}`);
    await interaction
      .reply({
        content:
          "An error occurred while processing your selection. Please try again later.",
        ephemeral: true,
      })
      .catch(() => {});
  }
});

setupBanHandlers(client, SERVER_CONFIG.MAIN_SERVER_ID);

// Set up error handling for unhandled rejections
process.on("unhandledRejection", (error) => {
  Logger.error(`Unhandled promise rejection: ${error}`);
});

process.on("uncaughtException", (error) => {
  Logger.error(`Uncaught exception: ${error}`);
  process.exit(1);
});

// Start the bot
client.login(process.env.TOKEN).catch((error) => {
  Logger.error(`Failed to login: ${error}`);
  process.exit(1);
});
