#!/usr/bin/env node
import { buildDependencyContainer } from "./di/buildDependencyContainer";
import { program } from "commander";
import fs from "fs";

// eslint-disable-next-line @typescript-eslint/no-var-requires
require("custom-env").env();

(async () => {
  const dependencyContainer = await buildDependencyContainer();
  const {
    cacheRunner,
    storage
  } = dependencyContainer.cradle;

  program
    .command("past")
    .description("Run for a past block count")
    .requiredOption("-b, --blocks <number>", "Past block count")
    .action(async (options) => {
      await cacheRunner.runForPastBlocks(Number(options.blocks));
      process.exit(0);
    });
  
  program
    .command("missed")
    .description("Run for missed blocks while the app was offline")
    .action(async (options) => {
      await cacheRunner.runForMissedBlocks();
      process.exit(0);
    });

  program
    .command("listen")
    .description("Listen for events and pin wrappers")
    .action(async (options) => {
      await cacheRunner.listenForEvents();
    });

  program
    .command("api")
    .description("Run the API")
    .requiredOption("-p, --port <number>", "Port number")
    .requiredOption("-l, --listen", "Listen to events")
    .action(async (options) => {
      if(options.listen) {
        await Promise.all([
          cacheRunner.runApi(+options.port),
          cacheRunner.listenForEvents()
        ]);
      } else {
        await cacheRunner.runApi(+options.port);
      }
    });

  program
    .command("unresponsive")
    .description("Process unresponsive IPFS URIs")
    .action(async (options) => {
      await cacheRunner.processUnresponsive();
      process.exit(0);
    });

  program
    .command("info")
    .description("Display useful information about the current state (pinned hash count, unresponsive count, etc)")
    .action(async (options) => {
      console.log(`Last block number was ${storage.lastBlockNumber}`);
      console.log(`There are ${Object.keys(storage.ensIpfs).length} pinned ENS domains`);
      console.log(`There are ${Object.keys(storage.ipfsEns).length} pinned IPFS hashes`);
      console.log(`There are ${Object.keys(storage.unresponsiveEnsNodes).length} unresponsive ENS domains/IPFS hashes`);
      process.exit(0);
    });

  program
    .command("reset")
    .description("Delete the storage file")
    .action(async (options) => {
      if(fs.existsSync("./storage.json")) {
        fs.rmSync("./storage.json");
      }
      process.exit(0);
    });

  program.parse(process.argv);
})();
