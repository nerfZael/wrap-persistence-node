import { ethers } from "ethers";
import { getPastContenthashChanges } from "../getPastContenthashChanges";
import { getIpfsHashFromContenthash } from "../getIpfsHashFromContenthash";
import { Storage } from "../types/Storage";
import { isWrapper } from "../isWrapper";
import * as IPFS from 'ipfs-core';
import { pinCid } from "../pinCid";
import { unpinCid } from "../unpinCid";
import { toShortString } from "../toShortString";
import { IpfsConfig } from "../config/IpfsConfig";
import { LoggerConfig } from "../config/LoggerConfig";

interface IDependencies {
  ethersProvider: ethers.providers.Provider;
  ensPublicResolver: ethers.Contract;
  storage: Storage;
  ipfsNode: IPFS.IPFS;
  ipfsConfig: IpfsConfig;
  loggerConfig: LoggerConfig;
}

export class CacheRunner {
  deps: IDependencies;

  constructor(deps: IDependencies) {
    this.deps = deps;
  }

  //TODO: runned missed events while updating
  async runForPastBlocks(blockCnt: number) {
    const latestBlock = await this.deps.ethersProvider.getBlockNumber();

    if(blockCnt !== 0) {
      this.deps.loggerConfig.shouldLog && console.log("Processing past blocks...");

      await this.processPastBlocks(latestBlock - blockCnt);
    }
  }

  async runForMissedBlocks() {
    this.deps.loggerConfig.shouldLog && console.log("Processing missed blocks...");
  
    await this.processPastBlocks(this.deps.storage.lastBlockNumber);
  }

  async listenForEvents() {
    const shouldLog = this.deps.loggerConfig.shouldLog;

    shouldLog && console.log("Listening for events...");
  
    this.deps.ensPublicResolver.on("ContenthashChanged", async (ensNode: string, contenthash: string, event: any) => {
      shouldLog && console.log("----------------------------------------------");
      await this.processEnsIpfs(ensNode, getIpfsHashFromContenthash(contenthash));

      this.deps.storage.lastBlockNumber = event.blockNumber - 1;
      await this.deps.storage.save();
      shouldLog && console.log("----------------------------------------------");
    });
  }

  async processPastBlocks(blockNumber: number) {    
    const resp = await getPastContenthashChanges(
      this.deps.ethersProvider, 
      this.deps.ensPublicResolver, 
      blockNumber
    );

    await this.processEnsNodes(resp.results.map(x => x.ensNode));

    this.deps.storage.lastBlockNumber = resp.toBlock;
    await this.deps.storage.save();
  }

  async processUnresponsive() {
    const shouldLog = this.deps.loggerConfig.shouldLog;
   
    shouldLog && console.log("Processing unresponsive packages...");
    
    const ensNodes = Object.keys(this.deps.storage.unresponsiveEnsNodes);
    this.deps.storage.unresponsiveEnsNodes = {};

    await this.processEnsNodes(ensNodes);
  }

  async processEnsIpfs(ensNode: string, ipfsHash: string | undefined): Promise<boolean> {
    const shouldLog = this.deps.loggerConfig.shouldLog;
   
    const ensIpfsCache = this.deps.storage.ensIpfs;
    const ipfsEnsCache = this.deps.storage.ipfsEns;

    if(!ipfsHash) {
      const savedIpfsHash = ensIpfsCache[ensNode];

      if(savedIpfsHash) {
        shouldLog && console.log("ENS no longer points to an IPFS hash");
        shouldLog && console.log("Unpinning...");

        const success = await unpinCid(this.deps.ipfsNode, this.deps.ipfsConfig, savedIpfsHash);
        
        if(success) {

          if(ipfsEnsCache[savedIpfsHash]) {
            delete ipfsEnsCache[savedIpfsHash];
          }

          delete ensIpfsCache[ensNode];

          shouldLog && console.log("Unpinned successfully");
        } else {
          shouldLog && console.log("Unpinning failed");
        }
      } else {
        shouldLog && console.log("Nothing changed");
      }

      return false;
    }

    if(Object.keys(this.deps.storage.unresponsiveEnsNodes).includes(ensNode)) {
      shouldLog && console.log(`Ens domain already included in unresponsive list (${Object.keys(this.deps.storage.unresponsiveEnsNodes).length})`);
      return false;
    }

    if(!ipfsEnsCache[ipfsHash]) {
      shouldLog && console.log(`Checking if ${ipfsHash} is a wrapper`);

      const resp = await isWrapper(this.deps.ipfsNode, this.deps.ipfsConfig, ipfsHash);

      if(resp === "no") {
        shouldLog && console.log("IPFS hash is not a valid wrapper");
        return false;
      } else if(resp === "timeout") {
        this.deps.storage.unresponsiveEnsNodes[ensNode] = true;
        shouldLog && console.log(`Added ${toShortString(ensNode)} to unresponsive list (${Object.keys(this.deps.storage.unresponsiveEnsNodes).length})`);
        return false;
      }

      const success = await pinCid(this.deps.ipfsNode, this.deps.ipfsConfig, ipfsHash);  

      if(!success) {
        shouldLog && console.log("Pinning failed");
        this.deps.storage.unresponsiveEnsNodes[ensNode] = true;
        shouldLog && console.log(`Added ${toShortString(ensNode)} to unresponsive list (${Object.keys(this.deps.storage.unresponsiveEnsNodes).length})`);
        return false;
      }

      ipfsEnsCache[ipfsHash] = ensNode;
      ensIpfsCache[ensNode] = ipfsHash;

      return true;
    } else {
      shouldLog && console.log(`${ipfsHash} is already pinned`);
      return false;
    }
  }

  async processEnsNodes(nodes: string[]) {
    const shouldLog = this.deps.loggerConfig.shouldLog;
   
    const ensNodes = [...new Set(nodes)];

    shouldLog && console.log(`Found ${ensNodes.length} eligible ENS domains`);

    if(!ensNodes.length) {
      return;
    }

    shouldLog && console.log(`Pinning...`);
    let pinnedCnt = 0;

    for(let i = 0; i < ensNodes.length; i++) {
      const ensNode = ensNodes[i];

      shouldLog && console.log("----------------------------------------------");
      shouldLog && console.log(`Retrieving contenthash for ${toShortString(ensNode)} (${i+1}/${ensNodes.length})`);
      
      try {
        const contenthash = await this.deps.ensPublicResolver.contenthash(ensNode);
        const ipfsHash = getIpfsHashFromContenthash(contenthash);
  
        shouldLog && console.log("Retrieved IPFS hash for ENS domain");
        const newlyPinned = await this.processEnsIpfs(ensNode, ipfsHash);

        if(newlyPinned) {
          pinnedCnt++;
        }
      } catch(ex) {
        shouldLog && console.log(`Added ${toShortString(ensNode)} to unresponsive list (${Object.keys(this.deps.storage.unresponsiveEnsNodes).length})`);
        shouldLog && console.log("Error retrieving contenthash");
        shouldLog && console.log(ex);
      }
      await this.deps.storage.save();
      shouldLog && console.log(`${pinnedCnt} newly pinned nodes`);
      shouldLog && console.log("----------------------------------------------");
    }

    shouldLog && console.log(`Finished processing ${ensNodes.length} ENS domains`);
    shouldLog && console.log(`${Object.keys(this.deps.storage.ipfsEns).length} pinned IPFS hashes`);

    shouldLog && console.log(`${Object.keys(this.deps.storage.unresponsiveEnsNodes).length} unresponsive domains/ipfs hashes`);
  }
}