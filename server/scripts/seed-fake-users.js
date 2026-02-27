import { hashPassword } from "../auth/password.js";
import { loadConfig } from "../config.js";
import { createDbPool } from "../db/pool.js";
import { createUsersRepository } from "../repositories/users.js";

const DEFAULT_PASSWORD = "DraftEngine123!";

const FAKE_USERS = Object.freeze([
  {
    email: "top.alpha@example.com",
    gameName: "TopAlpha",
    tagline: "NA1",
    primaryRole: "Top",
    secondaryRoles: ["Jungle"]
  },
  {
    email: "jungle.bravo@example.com",
    gameName: "JungleBravo",
    tagline: "NA1",
    primaryRole: "Jungle",
    secondaryRoles: ["Top"]
  },
  {
    email: "mid.charlie@example.com",
    gameName: "MidCharlie",
    tagline: "NA1",
    primaryRole: "Mid",
    secondaryRoles: ["ADC"]
  },
  {
    email: "adc.delta@example.com",
    gameName: "ADCDelta",
    tagline: "NA1",
    primaryRole: "ADC",
    secondaryRoles: ["Support"]
  },
  {
    email: "support.echo@example.com",
    gameName: "SupportEcho",
    tagline: "NA1",
    primaryRole: "Support",
    secondaryRoles: ["ADC"]
  },
  {
    email: "flex.foxtrot@example.com",
    gameName: "FlexFoxtrot",
    tagline: "NA1",
    primaryRole: "Mid",
    secondaryRoles: ["Top", "Support"]
  }
]);

async function upsertFakeUser(usersRepository, pool, passwordHash, fakeUser) {
  const existing = await usersRepository.findByEmail(fakeUser.email);
  if (existing) {
    await pool.query(
      `
        UPDATE users
        SET game_name = $2,
            tagline = $3,
            primary_role = $4,
            secondary_roles = $5
        WHERE id = $1
      `,
      [existing.id, fakeUser.gameName, fakeUser.tagline, fakeUser.primaryRole, fakeUser.secondaryRoles]
    );
    return {
      id: Number(existing.id),
      created: false
    };
  }

  const created = await usersRepository.createUser({
    email: fakeUser.email,
    passwordHash,
    gameName: fakeUser.gameName,
    tagline: fakeUser.tagline
  });

  if (!created) {
    throw new Error(`Failed to create fake user: ${fakeUser.email}`);
  }

  await usersRepository.updateProfileRoles(created.id, {
    primaryRole: fakeUser.primaryRole,
    secondaryRoles: fakeUser.secondaryRoles
  });

  return {
    id: Number(created.id),
    created: true
  };
}

async function run() {
  const config = loadConfig();
  const pool = createDbPool(config);
  const usersRepository = createUsersRepository(pool);
  const password = typeof process.env.FAKE_USERS_PASSWORD === "string" && process.env.FAKE_USERS_PASSWORD.trim() !== ""
    ? process.env.FAKE_USERS_PASSWORD.trim()
    : DEFAULT_PASSWORD;
  const passwordHash = await hashPassword(password);

  try {
    const results = [];
    for (const fakeUser of FAKE_USERS) {
      const result = await upsertFakeUser(usersRepository, pool, passwordHash, fakeUser);
      results.push({ ...fakeUser, ...result });
    }

    console.log(`Seeded ${results.length} fake users.`);
    console.log(`Password for all fake users: ${password}`);
    for (const entry of results) {
      const verb = entry.created ? "created" : "updated";
      console.log(`- [${verb}] id=${entry.id} email=${entry.email} role=${entry.primaryRole} ign=${entry.gameName}#${entry.tagline}`);
    }
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(`Failed to seed fake users: ${error.message}`);
  process.exit(1);
});
