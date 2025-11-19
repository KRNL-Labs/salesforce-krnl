const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await deployer.provider.getBalance(deployer.address)).toString());

  // Deploy DocumentAccessRegistry
  const DocumentAccessRegistry = await ethers.getContractFactory("DocumentAccessRegistry");
  const registry = await DocumentAccessRegistry.deploy(deployer.address);

  await registry.waitForDeployment();

  const registryAddress = await registry.getAddress();
  console.log("DocumentAccessRegistry deployed to:", registryAddress);

  // Verify contract if not on localhost
  if (network.name !== "localhost" && network.name !== "hardhat") {
    console.log("Waiting for block confirmations...");
    await registry.deploymentTransaction().wait(6);

    await hre.run("verify:verify", {
      address: registryAddress,
      constructorArguments: [deployer.address],
    });
  }

  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    contractAddress: registryAddress,
    deployerAddress: deployer.address,
    blockNumber: await ethers.provider.getBlockNumber(),
    timestamp: new Date().toISOString()
  };

  console.log("Deployment completed:", deploymentInfo);
  return deploymentInfo;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });