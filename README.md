# Global wrap cache

Global wrap cache is a Node.js console app with an integrated IPFS node that can crawl/listen for all ENS wrapper registrations (via content records) and automatically pin the IPFS URIs.
It achieves that by watching for the "Contenthash changed" events of the public ENS resolver and automatically, reading the specified IPFS hash and pinning the contents at that IPFS hash (only if the contents contain a valid wrapper).

Steps to run:
1. Clone the repo
2. Run "nvm install && nvm use"
3. Run "yarn" to install dependencies
4. Create a .env file from the .env.template and fill in the required information
5. Run "yarn dev {command}" to run the commands with ts-node

The following commands are supported:
- past [options]  Run for a past block count
- missed          Run for missed blocks while the app was offline
- listen          Listen for events and pin wrappers
- unresponsive    Process unresponsive IPFS URIs
- info            Display useful information about the current state (pinned hash count, unresponsive count, etc)
- reset           Delete the storage file
- help [command]  display help for command