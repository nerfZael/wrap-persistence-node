import { ethers } from "ethers";
import { getPastContenthashChanges } from "./getPastContenthashChanges";
import { getIpfsHashFromContenthash } from "./getIpfsHashFromContenthash";
import { Storage } from "./types/Storage";
import { isWrapper } from "./isWrapper";
import * as IPFS from 'ipfs-core';
import { pinCid } from "./pinCid";
import { unpinCid } from "./unpinCid";
import { toShortString } from "./toShortString";
import { IpfsConfig } from "./config/IpfsConfig";
import express from "express";
import multer, { memoryStorage } from "multer";
import { MulterFile } from "./MulterFile";

interface ICacheRunnerDependencies {
  ethersProvider: ethers.providers.Provider;
  ensPublicResolver: ethers.Contract;
  storage: Storage;
  ipfsNode: IPFS.IPFS;
  ipfsConfig: IpfsConfig;
}

export class CacheRunner {
  deps: ICacheRunnerDependencies;

  constructor(deps: ICacheRunnerDependencies) {
    this.deps = deps;
  }

  async runApi(port: number) {
    const app = express();
    
    const ipfs = this.deps.ipfsNode;

    const upload = multer({ 
      storage: memoryStorage(),
      limits: {
        fileSize: 0.5*1024*1024,
        files: 7
      }
    });
    app.post('/add', upload.fields([ { name: "files"}, { name: "options", maxCount: 1 } ]), async (req, res) => {
      // req.file is the name of your file in the form above, here 'uploaded_file'
      // req.body will hold the text fields, if there were any 
      if(!req.files) {
        res.json({
          error: "No files were uploaded"
        });
      }

      const options = req.body.options 
        ? JSON.parse(req.body.options)
        : {
          onlyHash: false,
        };
      
      await ipfs.repo.gc();
      const files: {files: MulterFile[]} = req.files as {files: MulterFile[]};

      let rootCID = "";
      for await (const file of ipfs.addAll(
        files.files.map(x => ({
          path: x.originalname,
          content: x.buffer
        })),
        {
          wrapWithDirectory: true,
          pin: false,
          onlyHash: options.onlyHash
        }
      )) {
        if (file.path.indexOf("/") === -1) {
          rootCID = file.cid.toString();
        }
      }
    
      res.json({
        cid: rootCID,
      });
    });

    app.listen( port, () => {
      // tslint:disable-next-line:no-console
      console.log(`Server started at http://localhost:${ port }` );
    });
  }

  //TODO: runned missed events while updating
  async runForPastBlocks(blockCnt: number) {
    const latestBlock = await this.deps.ethersProvider.getBlockNumber();

    if(blockCnt !== 0) {
      console.log("Processing past blocks...");

      await this.processPastBlocks(latestBlock - blockCnt);
    }
  }

  async runForMissedBlocks() {
    console.log("Processing missed blocks...");
  
    await this.processPastBlocks(this.deps.storage.lastBlockNumber);
  }

  async listenForEvents() {
    console.log("Listening for events...");
  
    this.deps.ensPublicResolver.on("ContenthashChanged", async (ensNode: string, contenthash: string, event: any) => {
      console.log("----------------------------------------------");
      await this.processEnsIpfs(ensNode, getIpfsHashFromContenthash(contenthash));

      this.deps.storage.lastBlockNumber = event.blockNumber - 1;
      await this.deps.storage.save();
      console.log("----------------------------------------------");
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
    console.log("Processing unresponsive packages...");
    
    const ensNodes = Object.keys(this.deps.storage.unresponsiveEnsNodes);
    this.deps.storage.unresponsiveEnsNodes = {};

    await this.processEnsNodes(ensNodes);
  }

  async processEnsIpfs(ensNode: string, ipfsHash: string | undefined): Promise<boolean> {
    const ensIpfsCache = this.deps.storage.ensIpfs;
    const ipfsEnsCache = this.deps.storage.ipfsEns;

    if(!ipfsHash) {
      const savedIpfsHash = ensIpfsCache[ensNode];

      if(savedIpfsHash) {
        console.log("ENS no longer points to an IPFS hash");
        console.log("Unpinning...");

        const success = await unpinCid(this.deps.ipfsNode, this.deps.ipfsConfig, savedIpfsHash);
        
        if(success) {

          if(ipfsEnsCache[savedIpfsHash]) {
            delete ipfsEnsCache[savedIpfsHash];
          }

          delete ensIpfsCache[ensNode];

          console.log("Unpinned successfully");
        } else {
          console.log("Unpinning failed");
        }
      } else {
        console.log("Nothing changed");
      }

      return false;
    }

    if(Object.keys(this.deps.storage.unresponsiveEnsNodes).includes(ensNode)) {
      console.log(`Ens domain already included in unresponsive list (${Object.keys(this.deps.storage.unresponsiveEnsNodes).length})`);
      return false;
    }

    if(!ipfsEnsCache[ipfsHash]) {
      console.log(`Checking if ${ipfsHash} is a wrapper`);

      const resp = await isWrapper(this.deps.ipfsNode, this.deps.ipfsConfig, ipfsHash);

      if(resp === "no") {
        console.log("IPFS hash is not a valid wrapper");
        return false;
      } else if(resp === "timeout") {
        this.deps.storage.unresponsiveEnsNodes[ensNode] = true;
        console.log(`Added ${toShortString(ensNode)} to unresponsive list (${Object.keys(this.deps.storage.unresponsiveEnsNodes).length})`);
        return false;
      }

      const success = await pinCid(this.deps.ipfsNode, this.deps.ipfsConfig, ipfsHash);  

      if(!success) {
        console.log("Pinning failed");
        this.deps.storage.unresponsiveEnsNodes[ensNode] = true;
        console.log(`Added ${toShortString(ensNode)} to unresponsive list (${Object.keys(this.deps.storage.unresponsiveEnsNodes).length})`);
        return false;
      }

      ipfsEnsCache[ipfsHash] = ensNode;
      ensIpfsCache[ensNode] = ipfsHash;

      return true;
    } else {
      console.log(`${ipfsHash} is already pinned`);
      return false;
    }
  }

  async processEnsNodes(nodes: string[]) {
    const ensNodes = [...new Set(nodes)];

    console.log(`Found ${ensNodes.length} eligible ENS domains`);

    if(!ensNodes.length) {
      return;
    }

    console.log(`Pinning...`);
    let pinnedCnt = 0;

    for(let i = 0; i < ensNodes.length; i++) {
      const ensNode = ensNodes[i];

      console.log("----------------------------------------------");
      console.log(`Retrieving contenthash for ${toShortString(ensNode)} (${i+1}/${ensNodes.length})`);
      
      try {
        const contenthash = await this.deps.ensPublicResolver.contenthash(ensNode);
        const ipfsHash = getIpfsHashFromContenthash(contenthash);
  
        console.log("Retrieved IPFS hash for ENS domain");
        const newlyPinned = await this.processEnsIpfs(ensNode, ipfsHash);

        if(newlyPinned) {
          pinnedCnt++;
        }
      } catch(ex) {
        console.log(`Added ${toShortString(ensNode)} to unresponsive list (${Object.keys(this.deps.storage.unresponsiveEnsNodes).length})`);
        console.log("Error retrieving contenthash");
        console.log(ex);
      }
      await this.deps.storage.save();
      console.log(`${pinnedCnt} newly pinned nodes`);
      console.log("----------------------------------------------");
    }

    console.log(`Finished processing ${ensNodes.length} ENS domains`);
    console.log(`${Object.keys(this.deps.storage.ipfsEns).length} pinned IPFS hashes`);

    console.log(`${Object.keys(this.deps.storage.unresponsiveEnsNodes).length} unresponsive domains/ipfs hashes`);
  }
}