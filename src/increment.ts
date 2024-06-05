import { BigNumber } from "@ethersproject/bignumber";
import "dotenv/config";
import axios from "axios";
import { ethers } from "ethers";

const SUBNET_RPC_URL = process.env.PUBLIC_SUBNET_RPC_URL || "";
const RELAYER_URL = process.env.GAS_RELAYER_RPC_URL || "";
const FORWARDER_ADDRESS = process.env.FORWARDER_ADDRESS || "";
const COUNTER_CONTRACT_ADDRESS = process.env.COUNTER_CONTRACT_ADDRESS || "";
const DOMAIN_NAME = process.env.DOMAIN_NAME || ""; // e.g. domain
const DOMAIN_VERSION = process.env.DOMAIN_VERSION || ""; // e.g. 1
const REQUEST_TYPE = process.env.REQUEST_TYPE || ""; // e.g. Message
// request_suffix = {suffix_type} {suffix_name}) = bytes32 ABCDEFGHIJKLMNOPQRSTGSN)
// suffix_type = bytes32
// suffix_name = ABCDEFGHIJKLMNOPQRSTGSN
// request_suffix = bytes32 ABCDEFGHIJKLMNOPQRSTGSN)
const SUFFIX_TYPE = process.env.SUFFIX_TYPE || "";
const SUFFIX_NAME = process.env.SUFFIX_NAME || "";
const REQUEST_SUFFIX = `${SUFFIX_TYPE} ${SUFFIX_NAME})`; // e.g. bytes32 ABCDEFGHIJKLMNOPQRSTGSN)

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

interface MessageTypeProperty {
  name: string;
  type: string;
}

interface MessageTypes {
  EIP712Domain: MessageTypeProperty[];
  [additionalProperties: string]: MessageTypeProperty[];
}

function getEIP712Message(
  domainName: string,
  domainVersion: string,
  chainId: number,
  forwarderAddress: string,
  data: string,
  from: string,
  to: string,
  gas: BigNumber,
  nonce: BigNumber
) {
  const types: MessageTypes = {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ],
    [REQUEST_TYPE]: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "gas", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "validUntilTime", type: "uint256" },
      { name: SUFFIX_NAME, type: SUFFIX_TYPE },
    ],
  };

  const message = {
    from: from,
    to: to,
    value: String("0x0"),
    gas: gas.toHexString(),
    nonce: nonce.toHexString(),
    data,
    validUntilTime: String(
      "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    ),
    [SUFFIX_NAME]: Buffer.from(REQUEST_SUFFIX, "utf8"),
  };

  const result = {
    domain: {
      name: domainName,
      version: domainVersion,
      chainId: chainId,
      verifyingContract: forwarderAddress,
    },
    types: types,
    primaryType: REQUEST_TYPE,
    message: message,
  };

  return result;
}

// ABIs for contracts
const FORWARDER_GET_NONCE_ABI = [
  {
    inputs: [
      {
        internalType: "address",
        name: "from",
        type: "address",
      },
    ],
    name: "getNonce",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];
const COUNTER_CONTRACT_INCREMENT_ABI = [
  {
    inputs: [],
    name: "increment",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

async function main() {
  const provider = new ethers.providers.JsonRpcProvider(SUBNET_RPC_URL);
  const account = new ethers.Wallet(PRIVATE_KEY, provider);

  // get network info from node
  const network = await provider.getNetwork();

  // get forwarder contract
  const forwarder = new ethers.Contract(
    FORWARDER_ADDRESS,
    FORWARDER_GET_NONCE_ABI,
    provider
  );

  // get current nonce in forwarder contract
  const forwarderNonce = await forwarder.getNonce(account.address);

  // get counter contract
  const gaslessCounter = new ethers.Contract(
    COUNTER_CONTRACT_ADDRESS,
    COUNTER_CONTRACT_INCREMENT_ABI,
    account
  );

  // get function selector for gasless "increment" method
  const fragment = gaslessCounter.interface.getFunction("increment");
  const func = gaslessCounter.interface.getSighash(fragment);

  const gas = await gaslessCounter.estimateGas.increment();
  console.log("estimated gas usage for increment(): " + gas);

  const eip712Message = getEIP712Message(
    DOMAIN_NAME,
    DOMAIN_VERSION,
    network.chainId,
    forwarder.address,
    func,
    account.address,
    COUNTER_CONTRACT_ADDRESS,
    BigNumber.from(gas),
    forwarderNonce
  );

  const { EIP712Domain, ...types } = eip712Message.types;
  const signature = await account._signTypedData(
    eip712Message.domain,
    types,
    eip712Message.message
  );

  const verifiedAddress = ethers.utils.verifyTypedData(
    eip712Message.domain,
    types,
    eip712Message.message,
    signature
  );

  if (verifiedAddress != account.address) {
    throw new Error("Fail sign and recover");
  }

  const tx = {
    forwardRequest: eip712Message,
    metadata: {
      signature: signature.substring(2),
    },
  };
  const rawTx = "0x" + Buffer.from(JSON.stringify(tx)).toString("hex");
  // wrap relay tx with json rpc request format.
  const requestBody = {
    id: 1,
    jsonrpc: "2.0",
    method: "eth_sendRawTransaction",
    params: [rawTx],
  };

  // send relay tx to relay server
  try {
    const result = await axios.post(RELAYER_URL, requestBody, {
      headers: {
        "Content-Type": "application/json",
      },
    });
    const txHash = result.data.result;
    console.log(`txHash : ${txHash}`);
    const receipt = await provider.waitForTransaction(txHash);
    console.log(`tx mined : ${JSON.stringify(receipt, null, 2)}`);
  } catch (e: any) {
    console.error("error occurred while sending transaction:", e.response.data);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
