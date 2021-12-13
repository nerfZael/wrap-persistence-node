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

  const hash1 = "QmZwKD7C8Ah7qL7xntSL8hujBnxpKwhV594jfFG6SFF61V";

  program
    .command("run-past")
    .requiredOption("-b, --blocks <number>", "Past block count")
    .action(async (options) => {
      await cacheRunner.runForPastBlocks(Number(options.blocks));
      await cacheRunner.listenForEvents();
    });
  
  program
    .command("run-missed")
    .action(async (options) => {
      await cacheRunner.runForMissedBlocks();
      await cacheRunner.listenForEvents();
    });

  program
    .command("run-listen")
    .action(async (options) => {
      await cacheRunner.listenForEvents();
    });

  program
    .command("process-unresponsive")
    .action(async (options) => {
      await cacheRunner.processUnresponsive();
      process.exit(0);
    });

  program
    .command("info")
    .action(async (options) => {
      console.log(`Last block number was ${storage.lastBlockNumber}`);
      console.log(`There are ${Object.keys(storage.ensIpfs).length} pinned ENS domains`);
      console.log(`There are ${Object.keys(storage.ipfsEns).length} pinned IPFS hashes`);
      console.log(`There are ${Object.keys(storage.unresponsiveEnsNodes).length} unresponsive ENS domains/IPFS hashes`);
      process.exit(0);
    });

  program
    .command("reset")
    .action(async (options) => {
      if(fs.existsSync("./storage.json")) {
        fs.rmSync("./storage.json");
      }
      process.exit(0);
    });

  program.parse(process.argv);
})();
