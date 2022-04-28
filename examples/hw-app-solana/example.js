const Transport = require("@ledgerhq/hw-transport-node-hid").default;
const Solana = require("@ledgerhq/hw-app-solana").default;
const solana = require("@solana/web3.js");
const { program } = require("commander");
const nacl = require("tweetnacl");
const bs58 = require("bs58");

(async () => {
    program
        .command("config")
        .action(async () => {
            const transport = await Transport.create();
            const ledger = new Solana(transport);
            const config = await ledger.getAppConfiguration();
            console.log("--- config:", config);
        });

    program
        .command("path [path]")
        .action(async (path) => {
            if (!path) path = "0'";
            //console.log(path);
            const transport = await Transport.create();
            const ledger = new Solana(transport);
            const r = await ledger.getAddress(`44'/501'/${path}`);
            console.log("--- address:", r.address);
            const pubkey_string = bs58.encode(r.address);
            console.log("--- pubkey:", pubkey_string);
        });

    program
        .command("sign <from_wallet_idx> <to_wallet_idx>")
        .action(async (from_idx, to_idx) => {
            const transport = await Transport.create();
            const ledger = new Solana(transport);
            const from_path = `44'/501'/${from_idx}'`;
            const form_address = (await ledger.getAddress(from_path)).address;
            console.log("--- from pubkey:", bs58.encode(form_address));
            const to_path = `44'/501'/${to_idx}'`;
            const to_address = (await ledger.getAddress(to_path)).address;
            console.log("---   to pubkey:", bs58.encode(to_address));

            const from_pubkey = new solana.PublicKey(form_address);
            const to_pubkey = new solana.PublicKey(to_address);
            const ix = solana.SystemProgram.transfer({
                fromPubkey: from_pubkey,
                toPubkey: to_pubkey,
                lamports: 42,
            });

            // XXX: Fake blockhash so this example doesn't need a
            // network connection. It should be queried from the
            // cluster in normal use.
            const recentBlockhash = bs58.encode(Buffer.from(Array(32).fill(3)));

            let tx = new solana.Transaction({
                recentBlockhash,
                feePayer: from_pubkey,
            })
                .add(ix);

            const msg_data = tx.serializeMessage();
            const sig_bytes = (await ledger.signTransaction(from_path, msg_data)).signature;

            const sig_string = bs58.encode(sig_bytes);
            console.log("--- len:", sig_bytes.length, "sig:", sig_string);

            tx.addSignature(from_pubkey, sig_bytes);
            console.log("--- verifies:", tx.verifySignatures());

            const connection = new solana.Connection(solana.clusterApiUrl('mainnet-beta'));
            console.log("--- fee:", await tx.getEstimatedFee(connection));
        });

    program
        .command("sign-rand-keys")
        .action(async () => {
            const from_keypair = solana.Keypair.generate();
            const to_keypair = solana.Keypair.generate();

            const ix = solana.SystemProgram.transfer({
                fromPubkey: from_keypair.publicKey,
                toPubkey: to_keypair.publicKey,
                lamports: 42,
            });

            // XXX: Fake blockhash so this example doesn't need a
            // network connection. It should be queried from the
            // cluster in normal use.
            const recentBlockhash = bs58.encode(Buffer.from(Array(32).fill(3)));

            let tx = new solana.Transaction({
                recentBlockhash,
                feePayer: from_keypair.publicKey,
            })
                .add(ix);

            const msg_data = tx.serializeMessage();
            const sig_bytes = nacl.sign.detached(msg_data, from_keypair.secretKey);

            const sig_string = bs58.encode(sig_bytes);
            console.log("--- len:", sig_bytes.length, "sig:", sig_string);

            tx.addSignature(from_keypair.publicKey, sig_bytes);
            console.log("--- verifies:", tx.verifySignatures());

            const connection = new solana.Connection(solana.clusterApiUrl('mainnet-beta'));
            console.log("--- fee:", await tx.getEstimatedFee(connection));
        });


    await program.parseAsync();
})().catch(e => console.log(e));
