const { inputToConfig } = require("@ethereum-waffle/compiler");
const { assert, expect } = require("chai");
const { network, getNamedAccounts, deployments, ethers, provider } = require("hardhat");
const { developmentChains, networkConfig } = require("../../helper-hardhat-config");

!developmentChains.includes(network.name)
	? describe.skip
	: describe("Raffle Unit Tests", function () {
			let raffle, vrfCoordinatorV2Mock, raffleEntranceFee, deployer, interval;
			const chainId = network.config.chainId;

			beforeEach(async function () {
				deployer = (await getNamedAccounts()).deployer;
				await deployments.fixture(["all"]);
				raffle = await ethers.getContract("Raffle", deployer);
				vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer);
				raffleEntranceFee = await raffle.getEntranceFee();
				interval = await raffle.getInterval();
			});

			describe("constructor", function () {
				it("initializes the raffle correctly", async function () {
					const raffleState = await raffle.getRaffleState();
					assert.equal(raffleState.toString(), "0");
					assert.equal(
						interval.toString(),
						networkConfig[chainId]["keepersUpdateInterval"]
					);
				});
			});
			describe("enterRaffle", function () {
				it("Reverts when you don't pay enough", async function () {
					await expect(raffle.enterRaffle()).to.be.revertedWith(
						"Raffle__SendMoreToEnterRaffle"
					);
				});
				it("Records players when they enter", async function () {
					await raffle.enterRaffle({ value: raffleEntranceFee });
					const playerFromContract = await raffle.getPlayer(0);
					assert.equal(playerFromContract, deployer);
				});
				it("emits event on enter", async function () {
					await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
						raffle,
						"RaffleEnter"
					);
				});
				it("doesn't allow entrance when raffle is calculating", async function () {
					await raffle.enterRaffle({ value: raffleEntranceFee });
					await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
					await network.provider.send("evm_mine", []);
					await raffle.performUpkeep([]);
					await expect(
						raffle.enterRaffle({ value: raffleEntranceFee })
					).to.be.revertedWith("Raffle__RaffleNotOpen");
				});
			});
			describe("checkUpkeep", function () {
				it("Returns false if people haven't sent any ETH", async function () {
					await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
					await network.provider.send("evm_mine", []);
					const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]);
					assert(!upkeepNeeded);
				});
				it("Returns false if raffle isn't open", async function () {
					await raffle.enterRaffle({ value: raffleEntranceFee });
					await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
					await network.provider.send("evm_mine", []);
					await raffle.performUpkeep([]);
					const raffleState = await raffle.getRaffleState();
					const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]);
					assert.equal(raffleState.toString(), "1");
					assert.equal(upkeepNeeded, false);
				});
				it("returns false if enough time hasn't passed", async () => {
					await raffle.enterRaffle({ value: raffleEntranceFee });
					await network.provider.send("evm_increaseTime", [interval.toNumber() - 5]); // use a higher number here if this test fails
					await network.provider.request({ method: "evm_mine", params: [] });
					const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x"); // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
					assert(!upkeepNeeded);
				});
				it("returns true if enough time has passed, has players, eth, and is open", async () => {
					await raffle.enterRaffle({ value: raffleEntranceFee });
					await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
					await network.provider.request({ method: "evm_mine", params: [] });
					const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x"); // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
					assert(upkeepNeeded);
				});
			});

			describe("performUpkeep", function () {
				it("It can only run if checkupkeep is true", async function () {
					await raffle.enterRaffle({ value: raffleEntranceFee });
					await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
					await network.provider.request({ method: "evm_mine", params: [] });
					const tx = await raffle.performUpkeep([]);
					assert(tx);
				});
				it("reverts when checkupkeep is false", async function () {
					await expect(raffle.performUpkeep([])).to.be.revertedWith(
						"Raffle__UpkeepNotNeeded"
					);
				});
				it("updates the raffle state, emits event, calls the vrf coordinator", async function () {
					await raffle.enterRaffle({ value: raffleEntranceFee });
					await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
					await network.provider.send("evm_mine", []);
					const txResponse = await raffle.performUpkeep([]);
					const txReceipt = await txResponse.wait(1);
					const requestId = txReceipt.events[1].args.requestId;
					const raffleState = await raffle.getRaffleState();
					assert(requestId.toNumber() > 0);
					assert(raffleState.toString() == "1");
				});
			});

			describe("fulfillRandomWords", function () {
				beforeEach(async function () {
					await raffle.enterRaffle({ value: raffleEntranceFee });
					await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
					await network.provider.send("evm_mine", []);
				});
				it("can only be called after performUpKeep", async function () {
					await expect(
						vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
					).to.be.revertedWith("nonexistent request");
					await expect(
						vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
					).to.be.revertedWith("nonexistent request");
				});
				it("picks a winner, resets the lottery, and sends money", async function () {
					const additionalEntrants = 3;
					const startingAccountIndex = 1;
					const accounts = await ethers.getSigners();
					for (
						let i = startingAccountIndex;
						i < startingAccountIndex + additionalEntrants;
						i++
					) {
						const accountConnectedRaffle = raffle.connect(accounts[i]);
						await accountConnectedRaffle.enterRaffle({ value: raffleEntranceFee });
					}
					const startingTimeStamp = await raffle.getLastTimeStamp();

					// performUpkeep (mock being chainlink keeper)
					// fulfillRandomWords (mock being chainlink vrf)
					// We will have to wait for the fulfillRandomWords to be called
					await new Promise(async (resolve, reject) => {
						raffle.once("WinnerPicked", async () => {
							console.log("Found the event!");
							try {
								const recentWinner = await raffle.getRecentWinner();
								console.log(recentWinner);
								console.log(accounts[0].address);
								console.log(accounts[1].address);
								console.log(accounts[2].address);
								console.log(accounts[3].address);
								console.log(accounts[4].address);
								const raffleState = await raffle.getRaffleState();
								const winnerEndingBalance = await accounts[1].getBalance();
								const endingTimeStamp = await raffle.getLastTimeStamp();
								await expect(raffle.getPlayer(1)).to.be.reverted;
								// Comparisons to check if our ending values are correct:
								assert.equal(recentWinner.toString(), accounts[1].address);
								assert.equal(raffleState.toString(), "0");
								assert.equal(
									winnerEndingBalance.toString(),
									winnerStartingBalance // startingBalance + ( (raffleEntranceFee * additionalEntrances) + raffleEntranceFee )
										.add(
											raffleEntranceFee
												.mul(additionalEntrants)
												.add(raffleEntranceFee)
										)
										.toString()
								);
								assert(endingTimeStamp > startingTimeStamp);
								resolve(); // if try passes, resolves the promise
							} catch (e) {
								reject(e); // if try fails, rejects the promise
							}
						});
						// Set up the listener
						// below the event will be fired and the listener will pick up and resolve
						const tx = await raffle.performUpkeep("0x");
						const txReceipt = await tx.wait(1);
						winnerStartingBalance = await accounts[1].getBalance();
						await vrfCoordinatorV2Mock.fulfillRandomWords(
							txReceipt.events[1].args.requestId,
							raffle.address
						);
					});
				});
			});
	  });
