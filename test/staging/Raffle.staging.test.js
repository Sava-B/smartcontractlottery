const { assert, expect } = require("chai");
const { getNamedAccounts, ethers, network } = require("hardhat");
const { developmentChains } = require("../../helper-hardhat-config");

developmentChains.includes(network.name)
	? describe.skip
	: describe("Raffle Staging Tests", function () {
			let raffle, raffleEntranceFee, deployer;

			beforeEach(async function () {
				deployer = (await getNamedAccounts()).deployer;
				raffle = await ethers.getContract("Raffle", deployer);
				raffleEntranceFee = await raffle.getEntranceFee();
			});

			describe("fulfillRandomWords", function () {
				it("works with live Chainlink Keepers and Chainlink VRF, we get a random winner", async function () {
					// enter the raffle
					console.log("Setting up test...");
					const startingTimeStamp = await raffle.getLastTimeStamp();
					const accounts = await ethers.getSigners();

					console.log("Setting up Listener...");
					console.log("Entering Raffle...");
					await raffle.enterRaffle({ value: raffleEntranceFee });
					console.log("Ok, time to wait...");
					const winnerStartingBalance = await accounts[0].getBalance();

					await new Promise(async (resolve, reject) => {
						console.log("got to here");
						// setup listener before we enter the raffle
						// Just in case the blockchain moves REALLY fast
						raffle.once("WinnerPicked", async () => {
							console.log("WinnerPicked event fired!");
							try {
								// add our asserts here
								const recentWinner = await raffle.getRecentWinner();
								const raffleState = await raffle.getRaffleState();
								const winnerEndingBalance = await accounts[0].getBalance();
								const endingTimeStamp = await raffle.getLastTimeStamp();

								// await expect(raffle.getPlayer(9)).to.be.reverted;
								console.log(accounts[0].address);
								console.log("recentWinner " + recentWinner);
								console.log("winnerStartingBalance " + winnerStartingBalance);
								assert.equal(recentWinner.toString(), accounts[0].address);
								assert.equal(raffleState, 0);
								assert.equal(
									winnerEndingBalance.toString(),
									winnerStartingBalance.add(raffleEntranceFee).toString()
								);
								assert(endingTimeStamp > startingTimeStamp);
								resolve();
							} catch (error) {
								console.log(error);
								reject(error);
							}
						});
						// //entering the raffle
						// console.log("Entering Raffle...");
						// const txResponse = await raffle.enterRaffle({ value: raffleEntranceFee });
						// const txReceipt = await txResponse.wait(6);
						// console.log("Time to wait...");
						// // emit accepts two parameters, 1st is contract, which will emit event, 2nd is event name in string form
						// expect(txReceipt).to.emit(raffle, "WinnerPicked"); // Expect the event to fire,
						// // Now the event is emitted, we can run our code to test for things after event is fired

						// console.log("WinnerPicked event fired");
						// try {
						// 	// add our asserts here
						// 	const recentWinner = await raffle.getRecentWinner();
						// 	const raffleState = await raffle.getRaffleState();
						// 	const winnerEndingBalance = await accounts[0].getBalance();
						// 	const endingTimeStamp = await raffle.getLastTimeStamp();

						// 	await expect(raffle.getPlayer(0)).to.be.reverted;
						// 	assert.equal(recentWinner.toString(), accounts[0].address);
						// 	assert.equal(raffleState, 0);
						// 	assert.equal(
						// 		winnerEndingBalance.toString(),
						// 		winnerStartingBalance.add(raffleEntranceFee).toString()
						// 	);
						// 	assert(endingTimeStamp > startingTimeStamp);
						// } catch (error) {
						// 	console.log(error);
						// }
						// Then entering the raffle
						// console.log("Setting up Listener...");
						// console.log("Entering Raffle...");
						// await raffle.enterRaffle({ value: raffleEntranceFee });
						// console.log("Ok, time to wait...");
						// const winnerStartingBalance = await accounts[0].getBalance();
						// and this code WONT complete until our listener has finished listening!
					});
				});
			});
	  });
