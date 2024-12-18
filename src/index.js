import { Client, GatewayIntentBits } from "discord.js";
import * as dotenv from "dotenv";
import chalk from "chalk";

dotenv.config();

const processedOperations = new Set();

const requiredEnvVars = ["TOKEN", "DRY_RUN"];
requiredEnvVars.forEach((varName) => {
  if (!process.env[varName]) {
    throw new Error(`Missing required environment variable: ${varName}`);
  }
});

const Logger = {
  formatMessage: (type, msg) => `[${new Date().toISOString()}] ${type} ${msg}`,
  info: (msg) => console.log(chalk.blue(Logger.formatMessage("INFO", msg))),
  role: (msg) => console.log(chalk.green(Logger.formatMessage("ROLE", msg))),
  sync: (msg) => console.log(chalk.cyan(Logger.formatMessage("SYNC", msg))),
  warn: (msg) => console.log(chalk.yellow(Logger.formatMessage("WARN", msg))),
  error: (msg) => console.log(chalk.red(Logger.formatMessage("ERROR", msg))),
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.MessageContent,
  ],
});

const DRY_RUN = process.env.DRY_RUN === "true";
const MAIN_SERVER_ID = "1309266911703334952";
const MAIN_MEMBER_ROLE_ID = "1309573703474085908";
const PENDING_ROLE_ID = "1309285797471588423";

const GUILD_ROLES = {
  GUILD1: { id: "1315072149173698580", name: "Tsunami" },
  GUILD2: { id: "1315071746721976363", name: "Hurricane" },
  GUILD3: { id: "1314816353797935214", name: "Avalanche" },
  GUILD4: { id: "1315072176839327846", name: "Hailstorm" },
};

const ROLE_PAIRS = {
  "1315072149173698580": {
    "1295522487349674095": "1315855506966839296",
  },
  "1315071746721976363": {
    "1295522487349674095": "1302381052253175828",
  },
  "1314816353797935214": {
    "1301569908152471675": "1309371684536717394",
    "1295522487349674095": "1302376038633832499",
  },
  "1315072176839327846": {
    "1295522487349674095": "1302372881317105684",
  },
};

client.once("ready", async () => {
  Logger.info(`Bot logged in as ${client.user.tag}`);
  try {
    await setupRoleSync(client);
    await initialSync(client);
  } catch (error) {
    Logger.error(`Setup failed: ${error}`);
  }
});

async function safeRoleOperation(member, role, operation, actionName) {
  if (!DRY_RUN) {
    await retryOperation(() => member.roles[operation](role));
    Logger.role(
      `${actionName} ${role.name} for ${member.user.username} in ${member.guild.name}`
    );
  }
}

async function hasGuildRole(member) {
  return Object.keys(ROLE_PAIRS).some((roleId) =>
    member.roles.cache.has(roleId)
  );
}

async function retryOperation(operation, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

async function syncRoleAdd(client, member, mainRoleId) {
  Logger.sync(`Starting role sync for ${member.user.username}`);
  try {
    await removeOtherGuildRoles(member, mainRoleId);
    if (!member.roles.cache.has(MAIN_MEMBER_ROLE_ID)) {
      await safeRoleOperation(
        member,
        MAIN_MEMBER_ROLE_ID,
        "add",
        "Added main member role to"
      );
    }
    await removePendingRole(client, member);
    await syncToSlaveServers(client, member, mainRoleId, "add");
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

    if (!hasOtherGuildRoles && member.roles.cache.has(MAIN_MEMBER_ROLE_ID)) {
      Logger.role(`Removing main member role from ${member.user.username}`);
      if (!DRY_RUN) {
        await retryOperation(() => member.roles.remove(MAIN_MEMBER_ROLE_ID));
      }
    }
    await syncToSlaveServers(client, member, mainRoleId, "remove");
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
      if (!DRY_RUN) {
        await member.roles.remove(roleId);
        Logger.role(
          `Removed guild role ${roleId} from ${member.user.username}`
        );
        await syncRoleRemove(client, member, roleId);
      }
    }
  }
}

async function removePendingRole(client, member) {
  const mainGuild = await client.guilds.fetch(MAIN_SERVER_ID);
  const mainMember = await mainGuild.members.fetch(member.id).catch(() => null);
  if (mainMember?.roles.cache.has(PENDING_ROLE_ID)) {
    if (!DRY_RUN) {
      await mainMember.roles.remove(PENDING_ROLE_ID);
      Logger.role(`Removed pending role from ${member.user.username}`);
    }
  }
}

async function syncToSlaveServers(client, member, mainRoleId, action) {
  const rolePairs = ROLE_PAIRS[mainRoleId];
  const syncPromises = [];

  for (const [serverId, slaveRoleId] of Object.entries(rolePairs)) {
    const operationKey = `${member.id}-${serverId}-${slaveRoleId}-${action}`;
    if (processedOperations.has(operationKey)) continue;
    processedOperations.add(operationKey);

    setTimeout(() => processedOperations.delete(operationKey), 1000);

    const syncPromise = (async () => {
      try {
        const slaveGuild = await client.guilds.fetch(serverId);
        const [slaveMember, role] = await Promise.all([
          slaveGuild.members.fetch(member.id).catch(() => null),
          slaveGuild.roles.fetch(slaveRoleId),
        ]);

        if (slaveMember && role && !DRY_RUN) {
          if (action === "add") {
            await retryOperation(() => slaveMember.roles.add(role));
            Logger.sync(
              `Added ${role.name} to ${member.user.username} in ${slaveGuild.name}`
            );
          } else {
            await retryOperation(() => slaveMember.roles.remove(role));
            Logger.sync(
              `Removed ${role.name} from ${member.user.username} in ${slaveGuild.name}`
            );
          }
        }
      } catch (error) {
        Logger.error(`Failed role ${action} in ${serverId}: ${error}`);
      }
    })();

    syncPromises.push(syncPromise);
  }

  await Promise.all(syncPromises);
}

async function initialSync(client) {
  Logger.info(`Starting initial sync (${DRY_RUN ? "DRY RUN" : "LIVE"})`);
  const mainGuild = await client.guilds.fetch(MAIN_SERVER_ID);

  const syncPromises = Object.entries(ROLE_PAIRS).map(
    async ([mainRoleId, slaveServers]) => {
      const mainRole = await mainGuild.roles.fetch(mainRoleId);
      if (!mainRole) {
        Logger.warn(`Main role ${mainRoleId} not found - skipping`);
        return;
      }

      const authorizedMembers = mainRole.members.map((member) => member.id);
      Logger.info(
        `${mainRole.name}: Found ${authorizedMembers.length} authorized members`
      );

      const serverSyncPromises = Object.entries(slaveServers).map(
        async ([slaveServerId, slaveRoleId]) => {
          try {
            const slaveGuild = await client.guilds.fetch(slaveServerId);
            const slaveRole = await slaveGuild.roles.fetch(slaveRoleId);

            if (!slaveRole) {
              Logger.warn(
                `Slave role ${slaveRoleId} not found in ${slaveGuild.name}`
              );
              return;
            }

            const memberPromises = authorizedMembers.map(
              async (authorizedId) => {
                const slaveMember = await slaveGuild.members
                  .fetch(authorizedId)
                  .catch(() => null);
                if (
                  slaveMember &&
                  !slaveMember.roles.cache.has(slaveRoleId) &&
                  !DRY_RUN
                ) {
                  await retryOperation(() => slaveMember.roles.add(slaveRole));
                  Logger.sync(
                    `Added ${slaveRole.name} to ${slaveMember.user.username}`
                  );
                }
              }
            );

            await Promise.all(memberPromises);
          } catch (error) {
            Logger.error(`Failed to sync ${slaveServerId}: ${error}`);
          }
        }
      );

      await Promise.all(serverSyncPromises);
    }
  );

  await Promise.all(syncPromises);
}

function setupRoleSync(client) {
  if (DRY_RUN) Logger.info("Running in DRY RUN mode");

  client.on("guildMemberUpdate", async (oldMember, newMember) => {
    // Determine if this is main or slave server
    const isMainServer = newMember.guild.id === MAIN_SERVER_ID;

    if (isMainServer) {
      // Handle main server role changes
      const addedGuildRoles = newMember.roles.cache.filter(
        (role) => !oldMember.roles.cache.has(role.id) && ROLE_PAIRS[role.id]
      );

      const removedGuildRoles = oldMember.roles.cache.filter(
        (role) => !newMember.roles.cache.has(role.id) && ROLE_PAIRS[role.id]
      );

      const memberRoleRemoved =
        oldMember.roles.cache.has(MAIN_MEMBER_ROLE_ID) &&
        !newMember.roles.cache.has(MAIN_MEMBER_ROLE_ID);

      const pendingRoleAdded =
        !oldMember.roles.cache.has(PENDING_ROLE_ID) &&
        newMember.roles.cache.has(PENDING_ROLE_ID);

      // Process role changes
      if (addedGuildRoles.size > 0) {
        for (const [_, role] of addedGuildRoles) {
          await retryOperation(() => syncRoleAdd(client, newMember, role.id));
        }
      }

      if (removedGuildRoles.size > 0) {
        for (const [_, role] of removedGuildRoles) {
          await retryOperation(() =>
            syncRoleRemove(client, newMember, role.id)
          );
        }
      }

      if (memberRoleRemoved && (await hasGuildRole(newMember))) {
        await safeRoleOperation(
          newMember,
          MAIN_MEMBER_ROLE_ID,
          "add",
          "Restored main member role to"
        );
      }

      if (pendingRoleAdded && (await hasGuildRole(newMember))) {
        await safeRoleOperation(
          newMember,
          PENDING_ROLE_ID,
          "remove",
          "Removed pending role from"
        );
      }
    } else {
      // Handle slave server role changes
      const slaveServerId = newMember.guild.id;

      // Find all main roles that map to this slave server
      const mainRoleConfigs = Object.entries(ROLE_PAIRS).filter(
        ([_, servers]) => Object.keys(servers).includes(slaveServerId)
      );

      if (mainRoleConfigs.length === 0) return;

      const mainGuild = await client.guilds.fetch(MAIN_SERVER_ID);
      const mainMember = await mainGuild.members
        .fetch(newMember.id)
        .catch(() => null);
      if (!mainMember) return;

      // Process each main role mapping
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
            await newMember.roles.remove(slaveRoleId);
            Logger.role(
              `Removed unauthorized role from ${newMember.user.username}`
            );
          }
        }

        if (mainMember.roles.cache.has(mainRoleId) && !hasRole) {
          Logger.warn(
            `Unauthorized role removal detected in ${newMember.guild.name}`
          );
          if (!DRY_RUN) {
            await newMember.roles.add(slaveRoleId);
            Logger.role(
              `Restored authorized role to ${newMember.user.username}`
            );
          }
        }
      }
    }
  });

  client.on("guildMemberAdd", async (member) => {
    if (member.guild.id === MAIN_SERVER_ID) {
      const hasGuildRole = Object.values(GUILD_ROLES).some((role) =>
        member.roles.cache.has(role.id)
      );
      if (
        hasGuildRole &&
        !member.roles.cache.has(MAIN_MEMBER_ROLE_ID) &&
        !DRY_RUN
      ) {
        await member.roles.add(MAIN_MEMBER_ROLE_ID);
        Logger.role(`Added main member role to ${member.user.username}`);
      }
      return;
    }

    const mainGuild = await client.guilds.fetch(MAIN_SERVER_ID);
    const mainMember = await mainGuild.members
      .fetch(member.id)
      .catch(() => null);
    if (!mainMember) return;

    for (const [mainRoleId, slaveServers] of Object.entries(ROLE_PAIRS)) {
      const slaveRoleId = slaveServers[member.guild.id];
      if (!slaveRoleId) continue;

      if (mainMember.roles.cache.has(mainRoleId)) {
        const role = await member.guild.roles.fetch(slaveRoleId);
        if (role && !DRY_RUN) {
          await member.roles.add(role);
          Logger.role(
            `Added ${role.name} to new member ${member.user.username} in ${member.guild.name}`
          );
        }
      }
    }
  });
}

client.login(process.env.TOKEN);
