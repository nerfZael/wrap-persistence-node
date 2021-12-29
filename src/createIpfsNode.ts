import * as IPFS from 'ipfs-core'

export const createIpfsNode = async (): Promise<IPFS.IPFS> => {
  const ipfsNode = await IPFS.create();
  const version = await ipfsNode.version()
  console.log('Version:', version.version)

  console.log("IPFS ID", await ipfsNode.id());
  console.log("isOnline", await ipfsNode.isOnline());

  console.log("Listing pins...");
  for await (const { cid } of await ipfsNode.pin.ls()) {
    console.log(cid);
  }

  return ipfsNode;
};