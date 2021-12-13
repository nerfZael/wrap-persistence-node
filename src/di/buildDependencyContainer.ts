import * as awilix from "awilix";
import { ethers } from "ethers";
import { NameAndRegistrationPair } from "awilix";
import { EthersConfig } from "../config/EthersConfig";
import { IpfsConfig } from "../config/IpfsConfig";
import { EnsConfig } from "../config/EnsConfig";
import * as IPFS from 'ipfs-core'
import { Storage } from "../types/Storage";
import { CacheRunner } from "../CacheRunner";

export const buildDependencyContainer = async(
  extensionsAndOverrides?: NameAndRegistrationPair<unknown>
): Promise<awilix.AwilixContainer<any>> => {
  const ipfsNode = await IPFS.create();

  const container = awilix.createContainer({
    injectionMode: awilix.InjectionMode.PROXY,
  });

  const storage = new Storage();

  await storage.load();

  container.register({
    ipfsConfig: awilix.asClass(IpfsConfig).singleton(),
    ethersConfig: awilix.asClass(EthersConfig).singleton(),
    ensConfig: awilix.asClass(EnsConfig).singleton(),
    ethersProvider: awilix
      .asFunction(({ ethersConfig }) => {
        return ethers.providers.getDefaultProvider(
          ethersConfig.providerNetwork
        );
      })
      .singleton(),
    ipfsNode: awilix
      .asFunction(({ }) => {
        return ipfsNode;
      })
      .singleton(),
    ensPublicResolver: awilix
      .asFunction(({ ensConfig, ethersProvider }) => {
        const contract = new ethers.Contract(ensConfig.ResolverAddr, ensConfig.ResolverAbi, ethersProvider);
        
        return contract;
      })
      .singleton(),
    storage: awilix
      .asFunction(({ }) => {
        return storage;
      })
      .singleton(),
    cacheRunner: awilix.asClass(CacheRunner).singleton(),
    ...extensionsAndOverrides,
  });

  return container;
};
