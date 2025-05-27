import {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} from "discord.js";
import { Logger } from "./utils/logger.js";
import { retryOperation } from "./roleSync.js";
import { debounce } from "lodash-es";
import { RETRY_CONFIG } from "./config.js";

const pendingRoleOperations = new Map();

// Debounced role operations with operation tracking
const debouncedRoleRemove = debounce(async (member, roleId) => {
  if (!member?.roles?.cache) return;

  const operationKey = `${member.id}-${roleId}`;
  const currentOperation = pendingRoleOperations.get(operationKey);

  // If there's already an operation in progress and it's recent, skip
  if (currentOperation && Date.now() - currentOperation < 1000) {
    Logger.info(
      `Skipping duplicate role remove operation for ${member.user.username}`
    );
    return;
  }

  pendingRoleOperations.set(operationKey, Date.now());

  try {
    if (member.roles.cache.has(roleId)) {
      await retryOperation(() => member.roles.remove(roleId));
    }
  } catch (error) {
    Logger.error(
      `Failed to remove role ${roleId} from ${member.user.username}: ${error}`
    );
  } finally {
    pendingRoleOperations.delete(operationKey);
  }
}, RETRY_CONFIG.OPERATION_TIMEOUT);

const debouncedRoleAdd = debounce(async (member, roleId) => {
  if (!member?.roles?.cache) return;

  const operationKey = `${member.id}-${roleId}`;
  const currentOperation = pendingRoleOperations.get(operationKey);

  // If there's already an operation in progress and it's recent, skip
  if (currentOperation && Date.now() - currentOperation < 1000) {
    Logger.info(
      `Skipping duplicate role add operation for ${member.user.username}`
    );
    return;
  }

  pendingRoleOperations.set(operationKey, Date.now());

  try {
    if (!member.roles.cache.has(roleId)) {
      await retryOperation(() => member.roles.add(roleId));
    }
  } catch (error) {
    Logger.error(
      `Failed to add role ${roleId} to ${member.user.username}: ${error}`
    );
  } finally {
    pendingRoleOperations.delete(operationKey);
  }
}, RETRY_CONFIG.OPERATION_TIMEOUT);

// Validate role configurations
function validateRoleConfig() {
  try {
    // Validate CLASS_CATEGORIES
    for (const [category, data] of Object.entries(CLASS_CATEGORIES)) {
      if (!data.id || !data.roles || !Array.isArray(data.roles)) {
        throw new Error(`Invalid configuration for category ${category}`);
      }

      data.roles.forEach((role, index) => {
        if (!role.name || !role.roleId || !role.emoji) {
          throw new Error(
            `Invalid role configuration in ${category} at index ${index}`
          );
        }
      });
    }

    // Validate EXTRA_ROLES
    if (!EXTRA_ROLES.id || !Array.isArray(EXTRA_ROLES.roles)) {
      throw new Error("Invalid EXTRA_ROLES configuration");
    }

    EXTRA_ROLES.roles.forEach((role, index) => {
      if (!role.name || !role.roleId || !role.emoji) {
        throw new Error(`Invalid extra role configuration at index ${index}`);
      }
    });
  } catch (error) {
    Logger.error(`Role configuration validation failed: ${error}`);
    throw error;
  }
}

export const CLASS_CATEGORIES = {
  TANK: {
    id: "Tank",
    roles: [
      {
        name: "SNS / GS",
        roleId: "1315087293408739401",
        emoji: "<:TankSNSGS:1315076330949181541>",
      },
      {
        name: "SNS / WAND",
        roleId: "1315087506105958420",
        emoji: "<:TankSNSWand:1315076332798873672>",
      },
      {
        name: "SNS / DAGGER",
        roleId: "1315087805650571366",
        emoji: "<:TankSNSDagger:1315076328793313382>",
      },
      {
        name: "SNS / SPEAR",
        roleId: "1323213957195894805",
        emoji: "<:Spear:1315081396888272997>",
      },
    ],
  },
  HEALER: {
    id: "Healer",
    roles: [
      {
        name: "WAND / BOW",
        roleId: "1315090429233991812",
        emoji: "<:HealerWandBow:1315075155122327685>",
      },
      {
        name: "WAND / STAFF",
        roleId: "1315090436703912058",
        emoji: "<:HealerWandStaff:1315076011464986757>",
      },
    ],
  },
  RANGED: {
    id: "Ranged",
    roles: [
      {
        name: "STAFF / BOW",
        roleId: "1315091763370786898",
        emoji: "<:RangedStaffBow:1315073466290016468>",
      },
      {
        name: "STAFF / DAGGER",
        roleId: "1315091966303797248",
        emoji: "<:RangedStaffDagger:1315073831106248846>",
      },
      {
        name: "BOW / DAGGER",
        roleId: "1315092313755881573",
        emoji: "<:RangedBowDagger:1315073575190925393>",
      },
    ],
  },
  MELEE: {
    id: "Melee",
    roles: [
      {
        name: "GS / DAGGER",
        roleId: "1315092445930717194",
        emoji: "<:MeleeGSDagger:1315073663741071481>",
      },
      {
        name: "SPEAR / DAGGER",
        roleId: "1323213919002689559",
        emoji: "<:Spear:1315081396888272997>",
      },
      {
        name: "SPEAR / GS",
        roleId: "1315093022483939338",
        emoji: "<:Spear:1315081396888272997>",
      },
    ],
  },
  BOMBER: {
    id: "Bomber",
    roles: [
      {
        name: "DAGGER / WAND",
        roleId: "1315092575509807215",
        emoji: "<:BomberWandDagger:1315073394009440286>",
      },
      {
        name: "XBOW / DAGGER",
        roleId: "1315092852690128907",
        emoji: "<:BomberXbowDagger:1315074523137314848>",
      },
    ],
  },
};

export const EXTRA_ROLES = {
  id: "Extra",
  roles: [
    {
      name: "Community Opt-Out",
      roleId: "1331671895925461132",
      emoji: "🔕",
      description: "Opt out of community channels",
    },
    {
      name: "Discord Updates",
      roleId: "1331672368069869601",
      emoji: "🔔",
      description: "Discord update notifications & reminders (guild only)",
    },
    {
      name: "Island",
      roleId: "1331673372127399977",
      emoji: "🏝️",
      description: "Island notifications (guild only)",
    },
    {
      name: "War Games",
      roleId: "1316112180298383371",
      emoji: "⚔️",
      description: "InHouse War Game notifications (guild only)",
    },
  ],
};

// Call validation after constants are defined
validateRoleConfig();

export const ALL_WEAPON_ROLES = Object.entries(CLASS_CATEGORIES).flatMap(
  ([categoryName, category]) =>
    category.roles.map((role) => {
      // Safer emoji parsing
      let emojiId;
      try {
        emojiId = role.emoji.match(/<:[^:]+:(\d+)>/)?.[1];
        if (!emojiId) throw new Error(`Invalid emoji format for ${role.name}`);
      } catch (error) {
        Logger.error(`Failed to parse emoji for ${role.name}: ${error}`);
        emojiId = "❓"; // Fallback emoji
      }

      return {
        label: role.name,
        value: role.roleId,
        emoji: emojiId,
        description: category.id,
      };
    })
);

export const ALL_EXTRA_ROLES = EXTRA_ROLES.roles.map((role) => ({
  label: role.name,
  value: role.roleId,
  emoji: role.emoji,
  description: role.description,
}));

// Add at the top with other constants
const WEAPON_ROLE_IDS = new Set(
  Object.values(CLASS_CATEGORIES)
    .flatMap((category) => category.roles)
    .map((role) => role.roleId)
);

const EXTRA_ROLE_IDS = new Set(EXTRA_ROLES.roles.map((role) => role.roleId));

// Helper function to get current weapon role (optimized)
function getCurrentWeaponRole(member) {
  if (!member?.roles?.cache) return null;

  // Use cached role IDs for faster lookup
  const weaponRoleId = Array.from(member.roles.cache.keys()).find((roleId) =>
    WEAPON_ROLE_IDS.has(roleId)
  );

  if (!weaponRoleId) return null;

  // Only do the full lookup when we know we have a weapon role
  return Object.values(CLASS_CATEGORIES)
    .flatMap((category) => category.roles)
    .find((role) => role.roleId === weaponRoleId);
}

// Helper function to enforce weapon role (optimized)
async function enforceWeaponRole(member) {
  if (!member?.roles?.cache) return null;

  const currentRole = getCurrentWeaponRole(member);
  if (!currentRole) return null;

  // Get roles to remove more efficiently
  const rolesToRemove = Array.from(member.roles.cache.keys()).filter(
    (roleId) => WEAPON_ROLE_IDS.has(roleId) && roleId !== currentRole.roleId
  );

  try {
    // Remove other weapon roles if any exist
    if (rolesToRemove.length > 0) {
      await Promise.all(
        rolesToRemove.map((roleId) => debouncedRoleRemove(member, roleId))
      );
    }

    // Ensure the current role is added
    if (!member.roles.cache.has(currentRole.roleId)) {
      await debouncedRoleAdd(member, currentRole.roleId);
    }

    return currentRole;
  } catch (error) {
    Logger.error(
      `Failed to enforce weapon role for ${member.user.username}: ${error}`
    );
    return null;
  }
}

// Optimize role changes function
function getRoleChanges(currentRoles, selectedRoles, validRoleIds) {
  if (
    !currentRoles?.has ||
    !Array.isArray(selectedRoles) ||
    !Array.isArray(validRoleIds)
  ) {
    return [[], []];
  }

  const selectedRolesSet = new Set(selectedRoles);
  const validRolesSet = new Set(validRoleIds);

  const rolesToRemove = Array.from(currentRoles.keys()).filter(
    (roleId) => validRolesSet.has(roleId) && !selectedRolesSet.has(roleId)
  );

  const rolesToAdd = selectedRoles.filter(
    (roleId) => !currentRoles.has(roleId)
  );

  return [rolesToRemove, rolesToAdd];
}

// Optimize class role removal
async function removeExistingClassRoles(member) {
  if (!member?.roles?.cache) return;

  const rolesToRemove = Array.from(member.roles.cache.keys()).filter((roleId) =>
    WEAPON_ROLE_IDS.has(roleId)
  );

  if (rolesToRemove.length > 0) {
    try {
      await Promise.all(
        rolesToRemove.map((roleId) => debouncedRoleRemove(member, roleId))
      );
    } catch (error) {
      Logger.error(
        `Failed to remove existing class roles for ${member.user.username}: ${error}`
      );
    }
  }
}

// Cache the category fields for embeds
const CATEGORY_FIELDS = Object.entries(CLASS_CATEGORIES).map(
  ([_, category]) => ({
    name: category.id,
    value: category.roles
      .map((role) => `${role.emoji} ${role.name}`)
      .join("\n"),
    inline: true,
  })
);

// Helper functions to create embeds and components
function createClassRoleEmbed() {
  return new EmbedBuilder()
    .setTitle("Class / Weapon Roles")
    .setDescription("Select your weapon combination below:")
    .setColor("#D11E00")
    .addFields(CATEGORY_FIELDS);
}

function createClassRoleComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("select_weapon")
        .setPlaceholder("Click here to select weapons")
        .addOptions(ALL_WEAPON_ROLES)
    ),
  ];
}

function createExtraRolesEmbed() {
  return new EmbedBuilder()
    .setTitle("Extra Roles")
    .setDescription("Select your additional roles below:")
    .setColor("#215B01");
}

function createExtraRoleComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("select_extra")
        .setPlaceholder("Click here to select roles")
        .setMinValues(0)
        .setMaxValues(ALL_EXTRA_ROLES.length)
        .addOptions(ALL_EXTRA_ROLES)
    ),
  ];
}

async function safeEdit(message, content, timeoutMs = 5000) {
  try {
    await Promise.race([
      message.edit(content),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Edit operation timed out")),
          timeoutMs
        )
      ),
    ]);
  } catch (error) {
    Logger.error(`Failed to edit message: ${error}`);
    throw error;
  }
}

export async function sendClassRoleEmbed(channel) {
  try {
    const message = await channel.send({
      embeds: [createClassRoleEmbed()],
      components: createClassRoleComponents(),
    });
    return message.id;
  } catch (error) {
    Logger.error(`Failed to send class role embed: ${error}`);
    throw error;
  }
}

export async function sendExtraRolesEmbed(channel) {
  try {
    const message = await channel.send({
      embeds: [createExtraRolesEmbed()],
      components: createExtraRoleComponents(),
    });
    return message.id;
  } catch (error) {
    Logger.error(`Failed to send extra roles embed: ${error}`);
    throw error;
  }
}

export async function ensureClassRoleEmbed(client, channelId) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      Logger.error(`Role selection channel ${channelId} not found`);
      return;
    }

    const messages = await channel.messages.fetch({ limit: 100 });

    // Simpler message finding
    const classEmbed = messages.find(
      (msg) =>
        msg.author.id === client.user.id &&
        msg.embeds[0]?.title === "Class / Weapon Roles"
    );

    const extraEmbed = messages.find(
      (msg) =>
        msg.author.id === client.user.id &&
        msg.embeds[0]?.title === "Extra Roles"
    );

    // Update or create embeds as needed
    if (!classEmbed) {
      await sendClassRoleEmbed(channel);
    } else {
      await safeEdit(classEmbed, {
        embeds: [createClassRoleEmbed()],
        components: createClassRoleComponents(),
      });
    }

    if (!extraEmbed) {
      await sendExtraRolesEmbed(channel);
    } else {
      await safeEdit(extraEmbed, {
        embeds: [createExtraRolesEmbed()],
        components: createExtraRoleComponents(),
      });
    }
  } catch (error) {
    Logger.error(`Failed to ensure class role embeds: ${error}`);
  }
}

// Add event handler for manual role changes
export function setupWeaponRoleEnforcement(client) {
  client.on("guildMemberUpdate", async (oldMember, newMember) => {
    try {
      // Skip if member objects are invalid
      if (!oldMember?.roles?.cache || !newMember?.roles?.cache) {
        Logger.warn(
          `Invalid member objects in role enforcement for ${
            newMember?.user?.username || "unknown user"
          }`
        );
        return;
      }

      // Check if this is a bot-initiated change FIRST
      const hasRecentOperation = [
        ...oldMember.roles.cache.keys(),
        ...newMember.roles.cache.keys(),
      ].some((roleId) => {
        const operationKey = `${newMember.id}-${roleId}`;
        const operationTime = pendingRoleOperations.get(operationKey);
        return operationTime && Date.now() - operationTime < OPERATION_TIMEOUT;
      });

      if (hasRecentOperation) {
        Logger.info(
          `Skipping role enforcement for ${newMember.user.username} (bot operation)`
        );
        return;
      }

      const oldWeaponRole = getCurrentWeaponRole(oldMember);
      const newWeaponRoles = Array.from(newMember.roles.cache.keys()).filter(
        (roleId) => WEAPON_ROLE_IDS.has(roleId)
      );

      // Handle no weapon roles case
      if (newWeaponRoles.length === 0) {
        if (oldWeaponRole) {
          Logger.info(
            `Restoring manually removed weapon role ${oldWeaponRole.name} for ${newMember.user.username}`
          );
          // Double-check the role hasn't been added back during our processing
          if (!newMember.roles.cache.has(oldWeaponRole.roleId)) {
            await debouncedRoleAdd(newMember, oldWeaponRole.roleId);
          }
        }
        return;
      }

      // Handle multiple weapon roles case
      if (newWeaponRoles.length > 1) {
        // Keep the most recently added role (the one that wasn't in oldMember)
        const addedRole = newWeaponRoles.find(
          (roleId) => !oldMember.roles.cache.has(roleId)
        );

        // Determine which role to keep
        const roleToKeep = addedRole || newWeaponRoles[0];
        const rolesToRemove = newWeaponRoles.filter(
          (roleId) => roleId !== roleToKeep
        );

        if (addedRole) {
          Logger.info(
            `User ${newMember.user.username} manually added a new weapon role. Removing old roles and keeping ${roleToKeep}`
          );
        }

        // Remove extra roles in parallel, but only if they still exist
        if (rolesToRemove.length > 0) {
          const validRolesToRemove = rolesToRemove.filter(
            (roleId) =>
              newMember.roles.cache.has(roleId) && roleId !== roleToKeep
          );

          if (validRolesToRemove.length > 0) {
            await Promise.all(
              validRolesToRemove.map((roleId) =>
                debouncedRoleRemove(newMember, roleId)
              )
            );
          }
        }
      }
    } catch (error) {
      Logger.error(
        `Failed to enforce weapon role for ${
          newMember?.user?.username || "unknown user"
        }: ${error}`
      );
    }
  });
}

function validateRoleSelection(member, roleId, roleIds, interaction) {
  if (!member?.roles?.cache) {
    interaction.reply({
      content: "Failed to process role selection: Invalid member state.",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  // Allow empty selections for extra roles
  if (
    interaction.customId === "select_extra" &&
    (!roleId || roleId.length === 0)
  ) {
    return true;
  }

  if (!roleIds.has(roleId)) {
    interaction.reply({
      content: "Invalid role selection.",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  return true;
}

export async function handleClassSelection(interaction) {
  try {
    const member = interaction.member;

    if (interaction.customId === "select_weapon") {
      const selectedRole = interaction.values[0];

      // Use the validation helper
      if (
        !validateRoleSelection(
          member,
          selectedRole,
          WEAPON_ROLE_IDS,
          interaction
        )
      ) {
        return;
      }

      // Get the role info for better messaging
      const roleInfo = Object.values(CLASS_CATEGORIES)
        .flatMap((category) => category.roles)
        .find((role) => role.roleId === selectedRole);

      if (!roleInfo) {
        Logger.error(`Role info not found for role ID: ${selectedRole}`);
        await interaction.reply({
          content:
            "Failed to process role selection: Role configuration error.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Skip if already has role
      if (member.roles.cache.has(selectedRole)) {
        await interaction.reply({
          content: `You are already using ${roleInfo.emoji} ${roleInfo.name}!`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      let oldRole = getCurrentWeaponRole(member);

      // Double check the old role still exists in case of concurrent changes
      if (oldRole && !member.roles.cache.has(oldRole.roleId)) {
        oldRole = null;
      }

      try {
        await interaction.deferReply({
          flags: [MessageFlags.Ephemeral],
        });

        await removeExistingClassRoles(member);
        await debouncedRoleAdd(member, selectedRole);

        await interaction.editReply({
          content: `Changed your weapon role from ${
            oldRole ? `${oldRole.emoji} ${oldRole.name}` : "none"
          } to ${roleInfo.emoji} ${roleInfo.name}!`,
        });
      } catch (error) {
        Logger.error(
          `Failed to update roles for ${member.user.username}: ${error}`
        );
        // Try to restore the old role if the update failed
        if (oldRole) {
          try {
            await debouncedRoleAdd(member, oldRole.roleId);
          } catch (restoreError) {
            Logger.error(`Failed to restore old role: ${restoreError}`);
          }
        }
        throw error; // Re-throw to trigger the error reply
      }
    } else if (interaction.customId === "select_extra") {
      const selectedRoles = interaction.values;

      // Handle empty selection (removing all roles)
      if (selectedRoles.length === 0) {
        try {
          await interaction.deferReply({
            flags: [MessageFlags.Ephemeral],
          });

          const currentRoles = member.roles.cache;
          const extraRoleIds = Array.from(EXTRA_ROLE_IDS);
          const rolesToRemove = extraRoleIds.filter((roleId) =>
            currentRoles.has(roleId)
          );

          if (rolesToRemove.length === 0) {
            await interaction.editReply({
              content: "You don't have any extra roles to remove!",
            });
            return;
          }

          // Remove roles directly
          await Promise.all(
            rolesToRemove.map((roleId) =>
              member.roles.remove(roleId).catch((error) => {
                Logger.error(
                  `Failed to remove role ${roleId} from ${member.user.username}: ${error}`
                );
              })
            )
          );

          await interaction.editReply({
            content: "All extra roles have been removed!",
          });
          return;
        } catch (error) {
          throw error;
        }
      }

      // Use the validation helper for extra roles
      if (
        !validateRoleSelection(
          member,
          selectedRoles[0],
          EXTRA_ROLE_IDS,
          interaction
        )
      ) {
        return;
      }

      const currentRoles = member.roles.cache;
      const extraRoleIds = Array.from(EXTRA_ROLE_IDS);

      // Skip if no changes
      const currentExtraRoles = extraRoleIds.filter((roleId) =>
        currentRoles.has(roleId)
      );
      if (
        selectedRoles.length === currentExtraRoles.length &&
        selectedRoles.every((roleId) => currentRoles.has(roleId))
      ) {
        await interaction.reply({
          content: "You already have these exact roles!",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      try {
        await interaction.deferReply({
          flags: [MessageFlags.Ephemeral],
        });

        // Process role changes
        const [rolesToRemove, rolesToAdd] = getRoleChanges(
          currentRoles,
          selectedRoles,
          extraRoleIds
        );

        // Verify roles still exist before proceeding
        const validRolesToAdd = rolesToAdd.filter(
          (roleId) => !currentRoles.has(roleId)
        );
        const validRolesToRemove = rolesToRemove.filter((roleId) =>
          currentRoles.has(roleId)
        );

        await Promise.all([
          ...validRolesToRemove.map((roleId) =>
            debouncedRoleRemove(member, roleId)
          ),
          ...validRolesToAdd.map((roleId) => debouncedRoleAdd(member, roleId)),
        ]);

        await interaction.editReply({
          content: "Your extra roles have been updated!",
        });
      } catch (error) {
        throw error;
      }
    }
  } catch (error) {
    Logger.error(
      `Role selection failed for ${
        interaction.member?.user?.username || "unknown user"
      }: ${error}`
    );

    // Check if we need to use reply or editReply
    const replyMethod = interaction.deferred ? "editReply" : "reply";
    await interaction[replyMethod]({
      content:
        "An error occurred while updating your roles. Please try again later.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }
}
// Add at the top with other constants
const OPERATION_TIMEOUT = 30000; // 30 seconds

// Add after the constants
function cleanupStaleOperations() {
  const now = Date.now();
  for (const [key, timestamp] of pendingRoleOperations.entries()) {
    if (now - timestamp > OPERATION_TIMEOUT) {
      pendingRoleOperations.delete(key);
    }
  }
}

// Add periodic cleanup
setInterval(cleanupStaleOperations, OPERATION_TIMEOUT);
