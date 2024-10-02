const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ora = require('ora');
const readline = require('readline');
const colors = require('colors');
const figlet = require('figlet');
const boxen = require('boxen');
const crypto = require('crypto');
const TelegramBot = require('node-telegram-bot-api');

class ByBit {
    constructor() {
        this.headers = {
            authority: "api.bybitcoinsweeper.com",
            accept: "*/*",
            "accept-encoding": "gzip, deflate, br, zstd",
            "accept-language": "en-US,en;q=0.9,vi;q=0.8",
            clienttype: "web",
            lang: "en",
            origin: "https://bybitcoinsweeper.com",
            referer: "https://bybitcoinsweeper.com/",
            "sec-ch-ua": '"Not.A/Brand";v="8", "Chromium";v="114", "Google Chrome";v="114"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
            priority: "u=1, i",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
        };
        this.info = { score: 0 };
        this.axiosInstance = axios.create({
            baseURL: "https://api.bybitcoinsweeper.com",
            timeout: 5000,
            headers: this.headers,
        });
        this.bot = new TelegramBot('7892944450:AAFGJHhpkqYmpgYoG2l7S1vOUKWgMg-X8lo', { polling: true });
        this.isRunning = false;
        this.userQueries = {};
        this.setupBot();
    }

    setupBot() {
        this.bot.on('polling_error', (error) => {
            console.log(`Polling error: ${error.code}`);
            if (error.code === 'ETELEGRAM') {
                console.log('Telegram API error. Restarting polling...');
                this.bot.stopPolling();
                setTimeout(() => {
                    this.bot.startPolling();
                }, 5000);
            }
        });

        this.bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            const message = "Welcome to ByBit Sweeper Bot!\n\n" +
                            "1. Type /add to ADD QUERY\n" +
                            "2. Type /reset to RESET YOUR QUERIES\n" +
                            "3. Type /run to START YOUR QUERIES\n" +
                            "4. Type /stop to STOP BOT\n\n" +
                            "Please join our Telegram group: https://t.me/savanop121";
            this.bot.sendMessage(chatId, message);
        });

        this.bot.onText(/\/add/, (msg) => {
            const chatId = msg.chat.id;
            this.bot.sendMessage(chatId, "Please enter the query to add:");
            this.bot.once('message', (queryMsg) => {
                const query = queryMsg.text;
                this.addQuery(chatId, query);
                this.bot.sendMessage(chatId, "Query added successfully!");
            });
        });

        this.bot.onText(/\/reset/, (msg) => {
            const chatId = msg.chat.id;
            this.resetQueries(chatId);
            this.bot.sendMessage(chatId, "Your queries have been reset.");
        });

        this.bot.onText(/\/run/, (msg) => {
            const chatId = msg.chat.id;
            if (!this.isRunning) {
                this.isRunning = true;
                this.bot.sendMessage(chatId, "Bot is starting...");
                this.main(chatId).catch(err => {
                    this.log(err.message, 'warning');
                    this.bot.sendMessage(chatId, "An error occurred: " + err.message);
                    this.isRunning = false;
                });
            } else {
                this.bot.sendMessage(chatId, "Bot is already running.");
            }
        });

        this.bot.onText(/\/stop/, (msg) => {
            const chatId = msg.chat.id;
            if (this.isRunning) {
                this.isRunning = false;
                this.bot.sendMessage(chatId, "Bot has been stopped.");
            } else {
                this.bot.sendMessage(chatId, "Bot is not running.");
            }
        });
    }

    addQuery(chatId, query) {
        if (!this.userQueries[chatId]) {
            this.userQueries[chatId] = [];
        }
        this.userQueries[chatId].push(query);
    }

    resetQueries(chatId) {
        this.userQueries[chatId] = [];
    }

    log(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const icons = {
            'info': '🟢',  
            'success': '🔵',
            'warning': '🟡'
        };
        const colorMap = {
            'info': colors.green,  
            'success': colors.cyan,
            'warning': colors.yellow
        };
        const icon = icons[type] || icons['info'];
        const coloredMessage = (colorMap[type] || colors.white)(message); 
        console.log(`${icon} [${timestamp}] ${coloredMessage}`);
    }

    async wait(seconds) {
        const spinner = ora(`Waiting ${seconds} seconds...`).start();
        for (let i = seconds; i > 0; i--) {
            spinner.text = `Waiting ${i} seconds...`;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        spinner.stop();
    }

    async request(method, url, data = null, retryCount = 0) {
        const headers = { ...this.headers };
        if (method === "POST" && data) headers["content-type"] = "application/json";
        if (this.gameHash) headers["X-Game-Hash"] = this.gameHash;

        try {
            const response = await this.axiosInstance({ method, url, data, headers });
            return { success: true, data: response.data };
        } catch (error) {
            if (error.response && error.response.status === 429 && retryCount < 3) {
                this.log("Too many requests, waiting before retrying...", "warning");
                await this.wait(5);
                return this.request(method, url, data, retryCount + 1);
            }
            if (error.response && error.response.status === 401 && retryCount < 1) {
                this.log("Token might be expired. Attempting to relogin...", "warning");
                const loginResult = await this.login(this.currentInitData);
                if (loginResult.success) {
                    this.log("Relogin successful. Retrying the original request...", "info");
                    return this.request(method, url, data, retryCount + 1);
                }
            }
            this.log(`Request error: ${error.message}`, "warning");
            if (error.response) {
                this.log(`Response status: ${error.response.status}`, "warning");
                this.log(`Response data: ${JSON.stringify(error.response.data)}`, "warning");
            }
            return { success: false, message: error.message, error };
        }
    }

    async login(initData) {
        this.currentInitData = initData;
        const payload = {
            initData: initData,
        };

        this.log(`Attempting to log in`, "info");

        const response = await this.request("POST", "api/auth/login", payload);
        if (response.success) {
            this.headers["Authorization"] = `Bearer ${response.data.accessToken}`;
            this.axiosInstance.defaults.headers["Authorization"] = `Bearer ${response.data.accessToken}`;
            this.axiosInstance.defaults.headers["tl-init-data"] = initData;
            this.log("Login successful, token received", "success");
            return {
                success: true,
                accessToken: response.data.accessToken,
                refreshToken: response.data.refreshToken,
                userId: response.data.id,
            };
        } else {
            this.log(`Login failed: ${response.message}`, "warning");
            if (response.error && response.error.response) {
                this.log(`Response data: ${JSON.stringify(response.error.response.data)}`, "warning");
            }
            return { success: false, error: response.message };
        }
    }

    async me() {
        const response = await this.request("GET", "api/users/me");
        if (response.success) {
            this.user_info = response.data;

            const infoBox = boxen(
                `First Name: ${this.user_info.firstName}   Score: ${this.user_info.score}   ByBit ID: ${this.user_info.bybitId}`, 
                {
                    padding: 1, 
                    margin: 1,  
                    borderColor: 'green', 
                    borderStyle: 'round', 
                    align: 'center' 
                }
            );

            console.log(infoBox);

            return true;
        } else {
            this.log(`Failed to get user info: ${response.message}`, 'warning');
            return false;
        }
    }

    generateHash(gameId) {
        return crypto.createHash('sha256').update(gameId + Date.now().toString()).digest('hex');
    }

    async start() {
        const response = await this.request("POST", "api/games/start", {});
        if (response.success) {
            this.game = response.data;
            this.log(`Game start response: ${JSON.stringify(response.data)}`, 'info');
            if (response.data.h) {
                this.gameHash = response.data.h;
                this.log(`Game hash (h) received: ${this.gameHash}`, 'info');
            } else {
                this.gameHash = this.generateHash(this.game.id);
                this.log(`Generated hash: ${this.gameHash}`, 'info');
            }
            return true;
        } else {
            this.log(`Failed to start game!`, "warning");
            return false;
        }
    }

    async win({ score, gameTime }) {
        const payload = {
            bagCoins: this.game.rewards.bagCoins,
            bits: this.game.rewards.bits,
            gifts: this.game.rewards.gifts,
            gameId: this.game.id,
            score: parseFloat(score),
            gameTime: parseInt(gameTime),
            h: this.gameHash
        };

        this.log(`Win request payload: ${JSON.stringify(payload)}`, 'info');

        try {
            const response = await this.request("POST", "api/games/win", payload);
            this.log(`Full win response: ${JSON.stringify(response)}`, 'info');
            
            if (response.success) {
                this.game = response.data;
                this.log(`Win response: ${JSON.stringify(response.data)}`, 'info');
                return true;
            } else {
                this.log(`Win request was not successful. Response: ${JSON.stringify(response)}`, 'warning');
                return false;
            }
        } catch (error) {
            this.log(`Failed game!`, "warning");
            if (error.response) {
                this.log(`Response status: ${error.response.status}`, "warning");
                this.log(`Response data: ${JSON.stringify(error.response.data)}`, "warning");
            } else {
                this.log(`Error: ${error.message}`, "warning");
            }
            return false;
        }
    }

    async askNumber(question, defaultValue) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            rl.question(colors.cyan(question), (answer) => {
                rl.close();
                const number = parseInt(answer);
                resolve(isNaN(number) ? defaultValue : number);
            });
        });
    }

    async playGame(gameNumber) {
        const minGameTime = 60; // Minimum 60 seconds
        const maxGameTime = 180; // Maximum 3 minutes
        const gameTime = Math.floor(Math.random() * (maxGameTime - minGameTime + 1)) + minGameTime;
        
        const minScore = 100;
        const maxScore = 500;
        const score = (Math.random() * (maxScore - minScore) + minScore).toFixed(5);

        this.log(`Starting game ${gameNumber} with play time of ${gameTime} seconds`, 'success');

        const start = await this.start();
        if (!start) return { score: 0, success: false };

        await this.wait(gameTime);

        const winResult = await this.win({ gameTime, score });
        if (winResult) {
            this.log(`Game ${gameNumber} completed, score: ${score}`, 'success');
            return { score: parseFloat(score), success: true };
        } else {
            this.log(`Game ${gameNumber} failed`, 'warning');
            return { score: 0, success: false };
        }
    }

    async processUser(initData, batchNumber, numberOfGames, chatId) {
        this.bot.sendMessage(chatId, `Starting Batch ${batchNumber}`);
        
        this.log(`Logging into account...`, 'success');
        const loginResult = await this.login(initData);
        if (loginResult.success) {
            this.log('Login successful!', 'success');
            this.bot.sendMessage(chatId, 'Login successful!');
        } else {
            this.log(`Login failed: ${loginResult.error}`, 'warning');
            this.bot.sendMessage(chatId, `Login failed: ${loginResult.error}`);
            return; 
        }

        const infoResult = await this.me();
        if (infoResult) {
            this.log(`Processing account for ${this.user_info.firstName}`, 'info');
            this.bot.sendMessage(chatId, `Processing account for ${this.user_info.firstName}`);
            let totalScore = 0;
            let localScore = 0;
            let successCount = 0;
            let failureCount = 0;

            const batchSize = 1; 
            const totalBatches = Math.ceil(numberOfGames / batchSize);

            let lastServerScore = this.user_info.score;
            let unchangedScoreCount = 0;
            const maxUnchangedScores = 5; 

            for (let batch = 0; batch < totalBatches; batch++) {
                if (!this.isRunning) {
                    this.bot.sendMessage(chatId, "Bot has been stopped.");
                    break;
                }
                const spinner = ora(`Playing batch ${batch + 1} of ${totalBatches}...`).start();
                const startGame = batch * batchSize;
                const endGame = Math.min(startGame + batchSize, numberOfGames);

                const gameTasks = [];
                for (let i = startGame; i < endGame; i++) {
                    gameTasks.push(this.playGame(i + 1));
                }

                try {
                    const results = await Promise.all(gameTasks);
                    results.forEach(res => {
                        totalScore += res.score;
                        localScore += res.score;
                        if (res.success) {
                            successCount++;
                        } else {
                            failureCount++;
                        }
                    });
                    spinner.succeed(`Batch ${batch + 1} completed. Total Score: ${totalScore}, Local Score: ${localScore}, Successes: ${successCount}, Failures: ${failureCount}`);
                    this.bot.sendMessage(chatId, `Batch ${batch + 1} completed. Total Score: ${totalScore}, Local Score: ${localScore}, Successes: ${successCount}, Failures: ${failureCount}`);
                } catch (error) {
                    spinner.fail('Error occurred during the batch.');
                    this.bot.sendMessage(chatId, 'Error occurred during the batch.');
                    const refreshResult = await this.login(initData);
                    if (refreshResult.success) {
                        this.log('Token refreshed. Retrying batch...', 'warning');
                        this.bot.sendMessage(chatId, 'Token refreshed. Retrying batch...');
                        
                        await this.wait(4); 
                        batch--; 
                    } else {
                        this.log('Failed to refresh token.', 'warning');
                        this.bot.sendMessage(chatId, 'Failed to refresh token.');
                    }
                }
                
                if (batch % 5 === 4) { 
                    await this.me(); 

                    if (this.user_info.score === lastServerScore) {
                        unchangedScoreCount++;
                        this.log(`Warning: Server score unchanged for ${unchangedScoreCount} checks`, 'warning');
                        this.bot.sendMessage(chatId, `Warning: Server score unchanged for ${unchangedScoreCount} checks`);
                        if (unchangedScoreCount >= maxUnchangedScores) {
                            this.log(`Server score hasn't increased for ${maxUnchangedScores} checks. Stopping.`, 'warning');
                            this.bot.sendMessage(chatId, `Server score hasn't increased for ${maxUnchangedScores} checks. Stopping.`);
                            break;
                        }
                    } else {
                        unchangedScoreCount = 0;
                        lastServerScore = this.user_info.score;
                    }

                    const scoreUpdateBox = boxen(
                        `Updated account Score: ${this.user_info.score}\nLocal Score: ${localScore}`, 
                        {
                            padding: 1, 
                            borderColor: 'cyan', 
                            borderStyle: 'round',
                            align: 'center'
                        }
                    );
                    console.log(scoreUpdateBox);
                    this.log(`Server Score: ${this.user_info.score}, Local Score: ${localScore}`, 'info');
                    this.bot.sendMessage(chatId, `Server Score: ${this.user_info.score}, Local Score: ${localScore}`);
                }

                if (batch < totalBatches - 1) {
                    this.log(`Waiting 3 seconds before starting next batch...`, 'info');
                    await this.wait(3); 
                }
            }

            this.log(`Account processing completed. Total Score: ${totalScore}, Local Score: ${localScore}, Successes: ${successCount}, Failures: ${failureCount}`, 'success');
            this.bot.sendMessage(chatId, `Account processing completed. Total Score: ${totalScore}, Local Score: ${localScore}, Successes: ${successCount}, Failures: ${failureCount}`);
        }

        await this.wait(3);
    }

    async main(chatId) {
        console.log(boxen(figlet.textSync('Sweeper', { horizontalLayout: 'full' }), { padding: 1, borderColor: 'red', borderStyle: 'double' }));
        this.bot.sendMessage(chatId, "ByBit Sweeper Bot is starting...");

        const totalGames = 100; // Default value
        const queries = this.userQueries[chatId] || [];
        const totalBatches = queries.length;

        for (let i = 0; i < queries.length; i++) {
            if (!this.isRunning) {
                this.bot.sendMessage(chatId, "Bot has been stopped.");
                break;
            }
            const initData = queries[i];
            await this.processUser(initData, i + 1, totalGames, chatId);
        }

        this.bot.sendMessage(chatId, "All your queries have been processed. Bot is now idle.");
        this.isRunning = false;
    }
}

const bybit = new ByBit();
