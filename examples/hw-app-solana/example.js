const Transport = require("@ledgerhq/hw-transport-node-hid").default;
const Solana = require("@ledgerhq/hw-app-solana").default;
const { program } = require("commander");
const bs58 = require("bs58");

(async () => {
    program
        .command("config")
        .action(async () => {
            var transport = await Transport.create();
            var ledger = await new Solana(transport);
            let config = await ledger.getAppConfiguration();
            console.log("--- config:", config);
        });

    program
        .command("path [path]")
        .action(async (path) => {
            if (!path) path = "0'";
            //console.log(path);
            var transport = await Transport.create();
            var ledger = await new Solana(transport);
            let r = await ledger.getAddress(`44'/501'/${path}`);
            console.log("--- address:", r.address);
            const pubkey_string = bs58.encode(r.address);
            console.log("--- pubkey:", pubkey_string);
        });

    await program.parseAsync();
})()
