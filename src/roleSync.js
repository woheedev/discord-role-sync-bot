import { Logger } from "./utils/logger.js";
import { RETRY_CONFIG } from "./config.js";
import { debounce } from "lodash-es";

// Rate limiting protection
const operationLimiter = new Map();

function canPerformOperation(key, timeout = RETRY_CONFIG.OPERATION_TIMEOUT) {
  const lastOperation = operationLimiter.get(key);
  return !lastOperation || Date.now() - lastOperation >= timeout;
}

export function getSlaveServerIds(ROLE_PAIRS, excludeFromBanSync = false) {
  const slaveServerIds = new Set();
  Object.values(ROLE_PAIRS).forEach((servers) => {
    Object.keys(servers).forEach((serverId) => {
      // Skip the specified server if we're getting servers for ban sync
      if (excludeFromBanSync && serverId === "1301569908152471675") {
        return;
      }
      slaveServerIds.add(serverId);
    });
  });
  return slaveServerIds;
}

export async function handleMemberOperation(client, userId, operation, reason) {
  const operationKey = `${userId}-${operation.name}`;
  if (!canPerformOperation(operationKey)) {
    Logger.warn(`Operation ${operation.name} for ${userId} is rate limited`);
    return;
  }

  const slaveServerIds = getSlaveServerIds(ROLE_PAIRS);
  const promises = Array.from(slaveServerIds).map(async (serverId) => {
    try {
      const slaveGuild = await client.guilds.fetch(serverId);
      await retryOperation(() => operation(slaveGuild, userId, reason));
      Logger.info(`${operation.name} ${userId} in ${slaveGuild.name}`);
    } catch (error) {
      Logger.error(
        `Failed to ${operation.name} ${userId} in ${serverId}: ${error}`
      );
    }
  });

  try {
    await Promise.all(promises);
  } catch (error) {
    Logger.error(`Batch operation failed: ${error}`);
  }
}

export async function retryOperation(
  operation,
  maxRetries = RETRY_CONFIG.MAX_RETRIES
) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (i === maxRetries - 1) break;

      // Exponential backoff
      const delay = RETRY_CONFIG.INITIAL_DELAY * Math.pow(2, i);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

// Simplified role operation
async function performRoleOperation(member, roleId, operation, actionName) {
  try {
    const role = await member.guild.roles.fetch(roleId);
    if (!role) return;

    Logger.role(
      `${actionName} ${role.name} for ${member.user.username} in ${member.guild.name}`
    );
    await retryOperation(() => member.roles[operation](role));
  } catch (error) {
    Logger.error(`Role operation failed: ${error}`);
    throw error;
  }
}

export async function handleRoleOperation(
  member,
  roleId,
  operation,
  actionName,
  DRY_RUN = false
) {
  if (DRY_RUN) return;

  const operationKey = `${member.id}-${roleId}-${operation}`;
  if (!canPerformOperation(operationKey)) {
    Logger.warn(`Rate limited: ${actionName} for ${member.user.username}`);
    return;
  }

  operationLimiter.set(operationKey, Date.now());
  try {
    await performRoleOperation(member, roleId, operation, actionName);
  } catch (error) {
    Logger.error(`Role operation failed for ${member.user.username}: ${error}`);
  }
}

// Simplified sync operation
const debouncedSyncOperation = debounce(
  async (
    client,
    member,
    mainRoleId,
    action,
    ROLE_PAIRS,
    processedOperations
  ) => {
    const rolePairs = ROLE_PAIRS[mainRoleId];
    if (!rolePairs) {
      Logger.warn(`No role pairs found for main role ${mainRoleId}`);
      return;
    }

    // Log the sync operation for debugging
    Logger.sync(`Syncing ${action} for role ${mainRoleId} to slave servers`);
    Logger.sync(`Role pairs: ${JSON.stringify(rolePairs)}`);

    const promises = Object.entries(rolePairs).map(
      async ([serverId, slaveRoleId]) => {
        const uniqueKey = `${member.id}-${serverId}-${slaveRoleId}-${action}`;
        if (processedOperations.has(uniqueKey)) {
          Logger.warn(`Operation already processed: ${uniqueKey}`);
          return;
        }

        processedOperations.add(uniqueKey);
        setTimeout(
          () => processedOperations.delete(uniqueKey),
          RETRY_CONFIG.OPERATION_TIMEOUT
        );

        try {
          const slaveGuild = await client.guilds.fetch(serverId);
          const slaveMember = await slaveGuild.members
            .fetch(member.id)
            .catch(() => null);
          if (!slaveMember) {
            Logger.warn(`Member ${member.id} not found in guild ${serverId}`);
            return;
          }

          // Check current role state
          const hasRole = slaveMember.roles.cache.has(slaveRoleId);
          if (action === "add" && hasRole) {
            Logger.info(`Member already has role in ${slaveGuild.name}`);
            return;
          }
          if (action === "remove" && !hasRole) {
            Logger.info(`Member doesn't have role in ${slaveGuild.name}`);
            return;
          }

          await performRoleOperation(
            slaveMember,
            slaveRoleId,
            action === "add" ? "add" : "remove",
            action === "add" ? "Added" : "Removed"
          );
        } catch (error) {
          Logger.error(`Failed to sync role in ${serverId}: ${error}`);
          throw error; // Propagate error for Promise.allSettled
        }
      }
    );

    const results = await Promise.allSettled(promises);
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      Logger.error(`${failures.length} role sync operations failed`);
      failures.forEach((f) => Logger.error(`Failure reason: ${f.reason}`));
    }
  },
  RETRY_CONFIG.OPERATION_TIMEOUT
);

export async function syncRoleToSlaveServers(
  client,
  member,
  mainRoleId,
  action,
  ROLE_PAIRS,
  processedOperations,
  DRY_RUN = false
) {
  if (DRY_RUN) {
    Logger.info(`[DRY RUN] Would sync ${action} for role ${mainRoleId}`);
    return;
  }

  const operationKey = `${member.id}-${mainRoleId}-${action}`;
  if (!canPerformOperation(operationKey)) {
    Logger.warn(`Rate limited: Role sync for ${member.user.username}`);
    return;
  }

  operationLimiter.set(operationKey, Date.now());
  await debouncedSyncOperation(
    client,
    member,
    mainRoleId,
    action,
    ROLE_PAIRS,
    processedOperations
  );
}

export async function initialBanSync(
  client,
  MAIN_SERVER_ID,
  ROLE_PAIRS,
  DRY_RUN = false
) {
  Logger.info("Starting initial ban sync");
  const mainGuild = await client.guilds.fetch(MAIN_SERVER_ID);
  const bans = await mainGuild.bans.fetch();

  const slaveServerIds = getSlaveServerIds(ROLE_PAIRS, true);

  for (const [userId, ban] of bans) {
    for (const serverId of slaveServerIds) {
      try {
        const slaveGuild = await client.guilds.fetch(serverId);
        const existingBan = await slaveGuild.bans
          .fetch(userId)
          .catch(() => null);

        if (!existingBan) {
          const reason = `Main server ban sync: ${
            ban.reason || "No reason provided"
          }`;
          await retryOperation(() =>
            slaveGuild.members.ban(userId, { reason })
          );
          Logger.info(
            `Synced ban for ${ban.user.username} to ${slaveGuild.name}`
          );
        }
      } catch (error) {
        Logger.error(
          `Failed to sync ban for ${userId} to ${serverId}: ${error}`
        );
      }
    }
  }
}

// Remove debounced operations since they're causing issues
async function banMember(guild, userId, reason) {
  try {
    await retryOperation(() => guild.members.ban(userId, { reason }));
    Logger.info(`Banned ${userId} in ${guild.name}`);
  } catch (error) {
    Logger.error(`Failed to ban ${userId} in ${guild.name}: ${error}`);
    throw error;
  }
}

async function unbanMember(guild, userId, reason) {
  try {
    await retryOperation(() => guild.members.unban(userId, reason));
    Logger.info(`Unbanned ${userId} in ${guild.name}`);
  } catch (error) {
    Logger.error(`Failed to unban ${userId} in ${guild.name}: ${error}`);
    throw error;
  }
}

export async function setupBanHandlers(client, MAIN_SERVER_ID, ROLE_PAIRS) {
  Logger.info("Setting up ban and kick handlers...");

  client.on("guildBanAdd", async (ban) => {
    Logger.info("Ban event received");
    if (ban.guild.id !== MAIN_SERVER_ID) return;

    Logger.info(`Ban detected for ${ban.user.username} in main server`);
    const reason = `Main server ban sync: ${
      ban.reason || "No reason provided"
    }`;
    const slaveServerIds = getSlaveServerIds(ROLE_PAIRS, true);

    // Process each slave server sequentially to avoid rate limits
    for (const serverId of slaveServerIds) {
      try {
        const slaveGuild = await client.guilds.fetch(serverId);
        const existingBan = await slaveGuild.bans
          .fetch(ban.user.id)
          .catch(() => null);

        if (!existingBan) {
          await banMember(slaveGuild, ban.user.id, reason);
        }
      } catch (error) {
        Logger.error(`Failed to ban in ${serverId}: ${error}`);
      }
    }
  });

  client.on("guildBanRemove", async (unban) => {
    Logger.info("Unban event received");
    if (unban.guild.id !== MAIN_SERVER_ID) return;

    Logger.info(`Unban detected for ${unban.user.username} in main server`);
    const reason = "Main server unban sync";
    const slaveServerIds = getSlaveServerIds(ROLE_PAIRS, true);

    // Process each slave server sequentially to avoid rate limits
    for (const serverId of slaveServerIds) {
      try {
        const slaveGuild = await client.guilds.fetch(serverId);
        const isBanned = await slaveGuild.bans
          .fetch(unban.user.id)
          .catch(() => null);

        if (isBanned) {
          await unbanMember(slaveGuild, unban.user.id, reason);
        }
      } catch (error) {
        Logger.error(`Failed to unban in ${serverId}: ${error}`);
      }
    }
  });

  client.on("guildMemberRemove", async (member) => {
    Logger.info("Member remove event received");
    if (member.guild.id !== MAIN_SERVER_ID) return;

    try {
      // Check audit logs with a smaller window but more direct approach
      const auditLogs = await member.guild
        .fetchAuditLogs({
          type: 20, // MEMBER_KICK
          limit: 1,
        })
        .catch(() => null);

      const kickLog = auditLogs?.entries.first();
      const isRecentKick =
        kickLog &&
        kickLog.target?.id === member.id &&
        kickLog.createdTimestamp > Date.now() - 5000; // 5 second window

      if (isRecentKick) {
        // It was a kick, sync to slave servers
        Logger.info(`Kick detected for ${member.user.username} in main server`);
        const reason = `Main server kick sync: ${
          kickLog.reason || "No reason provided"
        }`;
        const slaveServerIds = getSlaveServerIds(ROLE_PAIRS, true);

        // Process each slave server sequentially
        for (const serverId of slaveServerIds) {
          try {
            const slaveGuild = await client.guilds.fetch(serverId);
            const slaveMember = await slaveGuild.members
              .fetch(member.id)
              .catch(() => null);

            if (slaveMember) {
              await slaveMember.kick(reason);
              Logger.info(
                `Kicked ${member.user.username} from ${slaveGuild.name}`
              );
            }
          } catch (error) {
            Logger.error(`Failed to kick from ${serverId}: ${error}`);
          }
        }
      } else {
        // It was a leave or we missed the kick log, just clean up roles
        Logger.info(
          `Member ${member.user.username} left main server, cleaning up roles`
        );
        const slaveServerIds = getSlaveServerIds(ROLE_PAIRS, false);

        for (const serverId of slaveServerIds) {
          try {
            const slaveGuild = await client.guilds.fetch(serverId);
            const slaveMember = await slaveGuild.members
              .fetch(member.id)
              .catch(() => null);

            if (slaveMember) {
              // Remove all synced roles
              const rolesToRemove = Object.values(ROLE_PAIRS)
                .map((servers) => servers[serverId])
                .filter(
                  (roleId) => roleId && slaveMember.roles.cache.has(roleId)
                );

              for (const roleId of rolesToRemove) {
                await handleRoleOperation(
                  slaveMember,
                  roleId,
                  "remove",
                  "Removed role due to main server leave from",
                  false
                );
              }
            }
          } catch (error) {
            Logger.error(`Failed to clean up roles in ${serverId}: ${error}`);
          }
        }
      }
    } catch (error) {
      Logger.error(
        `Failed to handle member remove for ${member.user.username}: ${error}`
      );
    }
  });

  Logger.info("Ban and kick handlers setup complete");
}
