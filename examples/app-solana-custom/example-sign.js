/* package.json
{
  "name": "test",
  "version": "0.0.1",
  "description": "test",
  "main": "example-sign.js",
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "author": "solana",
  "license": "ISC",
  "dependencies": {
    "@ledgerhq/hw-transport-node-hid": "5.17.0",
    "bs58": "4.0.1",
    "tweetnacl": "1.0.3",
    "@solana/web3.js": "0.90.0",
    "assert": "2.0.0"
  }
}
*/

const Transport = require("@ledgerhq/hw-transport-node-hid").default;
const bs58 = require("bs58");
const nacl = require("tweetnacl");
const solana = require("@solana/web3.js");
const assert = require("assert");
const { program } = require("commander");

const INS_GET_PUBKEY = 0x05;
const INS_SIGN_MESSAGE = 0x06;

const P1_NON_CONFIRM = 0x00;
const P1_CONFIRM = 0x01;

const P2_EXTEND = 0x01;
const P2_MORE = 0x02;

const MAX_PAYLOAD = 255;

const LEDGER_CLA = 0xe0;

const STATUS_OK = 0x9000;

/*
 * Helper for chunked send of large payloads
 */
async function ledger_send(transport, instruction, p1, payload) {
  var p2 = 0;
  var payload_offset = 0;

  if (payload.length > MAX_PAYLOAD) {
    while ((payload.length - payload_offset) > MAX_PAYLOAD) {
      const buf = payload.slice(payload_offset, payload_offset + MAX_PAYLOAD);
      payload_offset += MAX_PAYLOAD;
      console.log("send", (p2 | P2_MORE).toString(16), buf.length.toString(16), buf);
      const reply = await transport.send(LEDGER_CLA, instruction, p1, (p2 | P2_MORE), buf);
      if (reply.length != 2) {
        throw new TransportError(
          "solana_send: Received unexpected reply payload",
          "UnexpectedReplyPayload"
        );
      }
      p2 |= P2_EXTEND;
    }
  }

  const buf = payload.slice(payload_offset);
  console.log("send", p2.toString(16), buf.length.toString(16), buf);
  const reply = await transport.send(LEDGER_CLA, instruction, p1, p2, buf);

  return reply.slice(0, reply.length - 2);
}

const BIP32_HARDENED_BIT = ((1 << 31) >>> 0);
function _harden(n) {
  return (n | BIP32_HARDENED_BIT) >>> 0;
}

function solana_derivation_path(account, change, address_index) {
  var length;
  if (typeof (account) === 'number') {
    if (typeof (change) === 'number') {
      length = 4;
      if (typeof (address_index) === 'number') {
        length = 5;
      }
    } else {
      length = 3;
    }
  } else {
    length = 2;
  }

  var derivation_path = Buffer.alloc(1 + (length * 4));
  var offset = 0;
  offset = derivation_path.writeUInt8(length, offset);
  offset = derivation_path.writeUInt32BE(_harden(44), offset);  // Using BIP44
  offset = derivation_path.writeUInt32BE(_harden(501), offset); // Solana's BIP44 path

  if (length > 2) {
    offset = derivation_path.writeUInt32BE(_harden(account), offset);
    if (length > 3) {
      offset = derivation_path.writeUInt32BE(_harden(change), offset);
      if (length == 5) {
        offset = derivation_path.writeUInt32BE(address_index, offset);
      }
    }
  }

  return derivation_path;
}

async function solana_ledger_get_pubkey(transport, derivation_path) {
  return ledger_send(transport, INS_GET_PUBKEY, P1_NON_CONFIRM, derivation_path);
}

async function solana_ledger_sign_transaction(transport, derivation_path, transaction) {
  const msg_bytes = transaction.compileMessage().serialize();

  // XXX: Ledger app only supports a single derivation_path per call ATM
  var num_paths = Buffer.alloc(1);
  num_paths.writeUInt8(1);

  const payload = Buffer.concat([num_paths, derivation_path, msg_bytes]);

  return ledger_send(transport, INS_SIGN_MESSAGE, P1_CONFIRM, payload);
}

async function solana_ledger_public_key(path) {
  var [account, change, address_index] = path.split('/');

  var transport = await Transport.create();

  const derivation_path = solana_derivation_path(account, change, address_index);
  const pubkey_bytes = await solana_ledger_get_pubkey(transport, derivation_path);
  const pubkey_string = bs58.encode(pubkey_bytes);
  console.log("--- pubkey:", pubkey_string);
}

async function solana_ledger_signing_test(from = '', to = '') {
  var [from_account, from_change, from_address_index] = from.split('/');
  var [to_account, to_change, to_address_index] = to.split('/');

  var from_path = "m/44'/501'";
  var to_path = "m/44'/501'";
  if (from_account) from_path += `/${from_account}'`;
  if (from_change) from_path += `/${from_change}'`;
  if (from_address_index) from_path += `/${from_address_index}`;
  if (to_account) to_path += `/${to_account}'`;
  if (to_change) to_path += `/${to_change}'`;
  if (to_address_index) to_path += `/${to_address_index}`;
  console.log(`-- from path: ${from_path}`);
  console.log(`--   to path: ${to_path}`);

  var transport = await Transport.create();

  const from_derivation_path = solana_derivation_path(from_account, from_change, from_address_index);
  const from_pubkey_bytes = await solana_ledger_get_pubkey(transport, from_derivation_path);
  const from_pubkey_string = bs58.encode(from_pubkey_bytes);
  console.log("--- from pubkey:", from_pubkey_string);

  const to_derivation_path = solana_derivation_path(to_account, to_change, to_address_index);
  const to_pubkey_bytes = await solana_ledger_get_pubkey(transport, to_derivation_path);
  const to_pubkey_string = bs58.encode(to_pubkey_bytes);
  console.log("---   to pubkey:", to_pubkey_string);

  const from_pubkey = new solana.PublicKey(from_pubkey_string);
  const to_pubkey = new solana.PublicKey(to_pubkey_string);
  const ix = solana.SystemProgram.transfer({
    fromPubkey: from_pubkey,
    toPubkey: to_pubkey,
    lamports: 42,
  });

  // XXX: Fake blockhash so this example doesn't need a
  // network connection. It should be queried from the
  // cluster in normal use.
  const recentBlockhash = bs58.encode(Buffer.from([
    3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
    3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
  ]));

  var tx = new solana.Transaction({
    recentBlockhash,
    feePayer: from_pubkey,
  })
    .add(ix);

  const sig_bytes = await solana_ledger_sign_transaction(transport, from_derivation_path, tx);

  const sig_string = bs58.encode(sig_bytes);
  console.log("--- len:", sig_bytes.length, "sig:", sig_string);

  tx.addSignature(from_pubkey, sig_bytes);
  console.log("--- verifies:", tx.verifySignatures());
}

(async () => {
  program.command('sign')
    .option("-f, --from <account/change/address_index>")
    .option("-t, --to <account/change/address_index>")
    .action(async (opts) => {
      // console.log(opts);
      await solana_ledger_signing_test(opts.from, opts.to);
    });

  program.command('pubkey')
    .argument("<account/change/address_index>")
    .action(async (path) => {
      // console.log(path);
      await solana_ledger_public_key(path);
    });


  program.parse();
})().catch(e => console.log(e));
