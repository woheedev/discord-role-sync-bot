import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
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
    GatewayIntentBits.GuildMessageReactions,
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
  // Main server role ID -> Slave server role IDs
  "1315072149173698580": {
    // Tsunami role on main
    "1295522487349674095": "1315855506966839296", // micros server : tsunami role
    "1301569908152471675": "1319063260481454120", // avalanche server : alliance t role
  },
  "1315071746721976363": {
    // Hurricane role on main
    "1295522487349674095": "1302381052253175828", // micros server : hurricane role
    "1301569908152471675": "1319067741373857883", // avalanche server : alliance hu role
  },
  "1314816353797935214": {
    // Avalanche role on main
    "1301569908152471675": "1309371684536717394", // avalanche server : avalanche role
    "1295522487349674095": "1302376038633832499", // micros server : avalanche role
  },
  "1315072176839327846": {
    // Hailstorm role on main
    "1295522487349674095": "1302372881317105684", // micros server : hailstorm role
    "1301569908152471675": "1319067702865956957", // avalanche server : alliance ha role
  },
};

const CLASS_CATEGORIES = {
  TANK: {
    id: "Tank",
    roles: [
      {
        name: "SNS / GS",
        roleId: "1315087293408739401", // SNS / GS
        emoji: "<:TankSNSGS:1315076330949181541>",
      },
      {
        name: "SNS / WAND",
        roleId: "1315087506105958420", // SNS / WAND
        emoji: "<:TankSNSWand:1315076332798873672>",
      },
      {
        name: "SNS / DAGGER",
        roleId: "1315087805650571366", // SNS / DAGGER
        emoji: "<:TankSNSDagger:1315076328793313382>",
      },
    ],
  },
  HEALER: {
    id: "Healer",
    roles: [
      {
        name: "WAND / BOW",
        roleId: "1315090429233991812", // WAND / BOW
        emoji: "<:HealerWandBow:1315075155122327685>",
      },
      {
        name: "WAND / STAFF",
        roleId: "1315090436703912058", // WAND / STAFF
        emoji: "<:HealerWandStaff:1315076011464986757>",
      },
      {
        name: "WAND / SNS",
        roleId: "1315090738500993115", // WAND / SNS
        emoji: "<:HealerWandSNS:1315076009598517391>",
      },
      {
        name: "WAND / DAGGER",
        roleId: "1315091030248263690", // WAND / DAGGER
        emoji: "<:HealerWandDagger:1315075526746046514>",
      },
    ],
  },
  RANGED: {
    id: "Ranged",
    roles: [
      {
        name: "STAFF / BOW",
        roleId: "1315091763370786898", // STAFF / BOW
        emoji: "<:RangedStaffBow:1315073466290016468>",
      },
      {
        name: "STAFF / DAGGER",
        roleId: "1315091966303797248", // STAFF / DAGGER
        emoji: "<:RangedStaffDagger:1315073831106248846>",
      },
      {
        name: "BOW / DAGGER",
        roleId: "1315092313755881573", // BOW / DAGGER
        emoji: "<:RangedBowDagger:1315073575190925393>",
      },
    ],
  },
  MELEE: {
    id: "Melee",
    roles: [
      {
        name: "GS / DAGGER",
        roleId: "1315092445930717194", // GS / DAGGER
        emoji: "<:MeleeGSDagger:1315073663741071481>",
      },
      {
        name: "SPEAR",
        roleId: "1315093022483939338", // SPEAR
        emoji: "<:Spear:1315081396888272997>",
      },
    ],
  },
  BOMBER: {
    id: "Bomber",
    roles: [
      {
        name: "DAGGER / WAND",
        roleId: "1315092575509807215", // DAGGER / WAND
        emoji: "<:BomberWandDagger:1315073394009440286>",
      },
      {
        name: "XBOW / DAGGER",
        roleId: "1315092852690128907", // XBOW / DAGGER
        emoji: "<:BomberXbowDagger:1315074523137314848>",
      },
    ],
  },
};

const EXTRA_ROLES = {
  id: "Extra",
  roles: [
    {
      name: "War Games",
      roleId: "1316112180298383371",
      emoji: "⚔️",
    },
    {
      name: "PvP",
      roleId: "1316112144600662176",
      emoji: "❗",
    },
  ],
};

const ALL_WEAPON_ROLES = Object.entries(CLASS_CATEGORIES).flatMap(
  ([categoryName, category]) =>
    category.roles.map((role) => {
      return {
        label: role.name,
        value: role.roleId,
        emoji: role.emoji.match(/<:[^:]+:(\d+)>/)[1],
        description: category.id,
      };
    })
);

const ALL_EXTRA_ROLES = EXTRA_ROLES.roles.map((role) => {
  return {
    label: role.name,
    value: role.roleId,
    emoji: role.emoji,
    description: EXTRA_ROLES.id,
  };
});

client.once("ready", async () => {
  Logger.info(`Bot logged in as ${client.user.tag}`);
  try {
    await setupRoleSync(client);
    //await initialSync(client);
    await ensureClassRoleEmbed(client, "1309287447863099486");
  } catch (error) {
    Logger.error(`Setup failed: ${error}`);
  }
});

async function sendClassRoleEmbed(channel, client) {
  const embed = new EmbedBuilder()
    .setTitle("Class / Weapon Roles")
    .setDescription("Select your weapon combination below:")
    .setColor("#D11E00");

  // Create select menu for all weapon roles
  const weaponSelect = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("select_weapon")
      .setPlaceholder("Click here to select weapons")
      .addOptions(ALL_WEAPON_ROLES)
  );

  const message = await channel.send({
    embeds: [embed],
    components: [weaponSelect],
  });

  return message.id;
}

async function handleClassSelection(interaction) {
  if (interaction.customId === "select_weapon") {
    const selectedRole = interaction.values[0];
    const member = interaction.member;

    await removeExistingClassRoles(member);
    await member.roles.add(selectedRole);

    await interaction.reply({
      content: "Your weapon role has been updated!",
      ephemeral: true,
    });
  } else if (interaction.customId === "select_extra") {
    const selectedRoles = interaction.values;
    const member = interaction.member;

    // Remove all extra roles first
    for (const role of EXTRA_ROLES.roles) {
      if (member.roles.cache.has(role.roleId)) {
        await member.roles.remove(role.roleId);
      }
    }

    // Add selected roles
    for (const roleId of selectedRoles) {
      await member.roles.add(roleId);
    }

    await interaction.reply({
      content: "Your extra roles have been updated!",
      ephemeral: true,
    });
  }
}

async function removeExistingClassRoles(member) {
  const classRoleIds = Object.values(CLASS_CATEGORIES).flatMap((category) =>
    category.roles.map((role) => role.roleId)
  );

  for (const roleId of classRoleIds) {
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
    }
  }
}

async function sendExtraRolesEmbed(channel, client) {
  const embed = new EmbedBuilder()
    .setTitle("Extra Roles")
    .setDescription("Select your additional roles below:")
    .setColor("#215B01");

  const extraSelect = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("select_extra")
      .setPlaceholder("Click here to select roles")
      .setMinValues(0)
      .setMaxValues(ALL_EXTRA_ROLES.length)
      .addOptions(ALL_EXTRA_ROLES)
  );

  const message = await channel.send({
    embeds: [embed],
    components: [extraSelect],
  });

  return message.id;
}

async function ensureClassRoleEmbed(client, channelId) {
  const channel = await client.channels.fetch(channelId);
  const messages = await channel.messages.fetch({ limit: 100 });

  const classEmbed = messages.find(
    (m) => m.embeds.length > 0 && m.embeds[0].title === "Class / Weapon Roles"
  );

  const extraEmbed = messages.find(
    (m) => m.embeds.length > 0 && m.embeds[0].title === "Extra Roles"
  );

  if (!classEmbed) {
    await sendClassRoleEmbed(channel, client);
  }

  if (!extraEmbed) {
    await sendExtraRolesEmbed(channel, client);
  }
}

async function safeRoleOperation(member, role, operation, actionName) {
  Logger.role(
    `${DRY_RUN ? "[DRY RUN] " : ""}${actionName} ${role.name} for ${
      member.user.username
    } in ${member.guild.name}`
  );
  if (!DRY_RUN) {
    await retryOperation(() => member.roles[operation](role));
  }
}

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

  // Get all roles that could be mapped to this slave server
  const relevantRolePairs = Object.entries(rolePairs).filter(([_, servers]) =>
    Object.keys(servers).includes(slaveServerId)
  );

  // Check each role mapping
  for (const [mainRoleId, slaveServers] of relevantRolePairs) {
    const slaveRoleId = slaveServers[slaveServerId];
    if (!slaveRoleId) continue;

    // If member has slave role but not main role, remove it
    if (
      slaveMember.roles.cache.has(slaveRoleId) &&
      !mainMember.roles.cache.has(mainRoleId)
    ) {
      const role = await slaveGuild.roles.fetch(slaveRoleId);
      if (role) {
        Logger.role(
          `${DRY_RUN ? "[DRY RUN] " : ""}Removed unauthorized role ${
            role.name
          } from ${slaveMember.user.username} in ${slaveGuild.name}`
        );
        if (!DRY_RUN) {
          await retryOperation(() => slaveMember.roles.remove(role));
        }
      }
    }
  }
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

        if (slaveMember && role) {
          if (action === "add") {
            Logger.sync(
              `${DRY_RUN ? "[DRY RUN] " : ""}Added ${role.name} to ${
                member.user.username
              } in ${slaveGuild.name}`
            );
            if (!DRY_RUN) {
              await retryOperation(() => slaveMember.roles.add(role));
            }
          } else {
            Logger.sync(
              `${DRY_RUN ? "[DRY RUN] " : ""}Removed ${role.name} from ${
                member.user.username
              } in ${slaveGuild.name}`
            );
            if (!DRY_RUN) {
              await retryOperation(() => slaveMember.roles.remove(role));
            }
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

  const slaveServerIds = new Set();
  Object.values(ROLE_PAIRS).forEach((servers) => {
    Object.keys(servers).forEach((serverId) => slaveServerIds.add(serverId));
  });

  // Check each slave server
  for (const slaveServerId of slaveServerIds) {
    try {
      const slaveGuild = await client.guilds.fetch(slaveServerId);
      const members = await slaveGuild.members.fetch();

      // Check each member for unauthorized roles
      for (const [_, slaveMember] of members) {
        const mainMember = await mainGuild.members
          .fetch(slaveMember.id)
          .catch(() => null);
        if (mainMember) {
          await removeUnauthorizedRoles(slaveGuild, mainMember, ROLE_PAIRS);
        }
      }
    } catch (error) {
      Logger.error(
        `Failed to check unauthorized roles in ${slaveServerId}: ${error}`
      );
    }
  }

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
                if (slaveMember && !slaveMember.roles.cache.has(slaveRoleId)) {
                  Logger.sync(
                    `${DRY_RUN ? "[DRY RUN] " : ""}Added ${slaveRole.name} to ${
                      slaveMember.user.username
                    }`
                  );
                  if (!DRY_RUN) {
                    await retryOperation(() =>
                      slaveMember.roles.add(slaveRole)
                    );
                  }
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

client.on("interactionCreate", async (interaction) => {
  if (interaction.isStringSelectMenu()) {
    await handleClassSelection(interaction);
  }
});

client.login(process.env.TOKEN);
