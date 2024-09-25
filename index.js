const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ora = require('ora');
const readline = require('readline');
const colors = require('colors');
const figlet = require('figlet');
const boxen = require('boxen');

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
        try {
            const response = await this.axiosInstance({ method, url, data, headers });
            return { success: true, data: response.data };
        } catch (error) {
            if (error.response && error.response.status === 429 && retryCount < 3) {
                this.log("Too many requests, waiting before retrying...", "warning");
                await this.wait(60); // Tunggu 60 detik sebelum mencoba lagi
                return this.request(method, url, data, retryCount + 1); // Coba request ulang
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

        this.log(`Attempting to log in with initData`, "info");

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

    async start() {
        const response = await this.request("POST", "api/games/start", {});
        if (response.success) {
            this.game = response.data;
            return true;
        } else {
            this.log(`Failed to start game!`, "warning");
            return false;
        }
    }

    async win({ score, gameTime }) {
        const response = await this.request("POST", "api/games/win", {
            bagCoins: this.game.rewards.bagCoins,
            bits: this.game.rewards.bits,
            gifts: this.game.rewards.gifts,
            gameId: this.game.id,
            score,
            gameTime,
        });
        if (response.success) {
            this.game = response.data;
            return true;
        } else {
            this.log(`Failed game!`, "warning");
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
        const gameTime = Math.floor(Math.random() * (112 - 90 + 1)) + 90;
        const score = Math.floor(Math.random() * (900 - 600 + 1)) + 600;

        this.log(`Starting game ${gameNumber} with play time of ${gameTime} seconds`, 'success');
        
        const start = await this.start();
        if (!start) return { score: 0, success: false };

        await this.wait(gameTime);

        const winResult = await this.win({ gameTime, score });
        if (winResult) {
            this.log(`Game ${gameNumber} completed, score: ${score}`, 'success');
            return { score, success: true };
        } else {
            this.log(`Game ${gameNumber} failed`, 'warning');
            return { score: 0, success: false };
        }
    }

    async processUser(initData, batchNumber, numberOfGames) {
        console.log(boxen(`Batch ${batchNumber}`, { padding: 1, borderColor: 'blue', borderStyle: 'round' }));
        
        this.log(`Logging into account...`, 'success');
        const loginResult = await this.login(initData);
        if (loginResult.success) {
            this.log('Login successful!', 'success');
        } else {
            this.log(`Login failed: ${loginResult.error}`, 'warning');
            return; 
        }

        const infoResult = await this.me();
        if (infoResult) {
            this.log(`Processing account for ${this.user_info.firstName}`, 'info');
            let totalScore = 0;
            let successCount = 0;
            let failureCount = 0;

            const batchSize = 1; 
            const totalBatches = Math.ceil(numberOfGames / batchSize);

            for (let batch = 0; batch < totalBatches; batch++) {
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
                        if (res.success) {
                            successCount++;
                        } else {
                            failureCount++;
                        }
                    });
                    spinner.succeed(`Batch ${batch + 1} completed. Total Score: ${totalScore}, Successes: ${successCount}, Failures: ${failureCount}`);
                } catch (error) {
                    spinner.fail('Error occurred during the batch.');
                    const refreshResult = await this.login(initData);
                    if (refreshResult.success) {
                        this.log('Token refreshed. Retrying batch...', 'warning');
                        
                        await this.wait(4); 
                        batch--; 
                    } else {
                        this.log('Failed to refresh token.', 'warning');
                    }
                }
				
				if (batch % 5 === 4) { 
                    await this.me(); 
                                        
                    console.log(colors.bold(`Updated account Score: ${this.user_info.score}`));
                }

                if (batch < totalBatches - 1) {
                    this.log(`Waiting 3 seconds before starting next batch...`, 'info');
                    await this.wait(3); 
                }
            }

            this.log(`Account processing completed. Total Score: ${totalScore}, Successes: ${successCount}, Failures: ${failureCount}`, 'success');
        }

        await this.wait(3);
    }

    async main() {
        console.log(boxen(figlet.textSync('Sweeper', { horizontalLayout: 'full' }), { padding: 1, borderColor: 'red', borderStyle: 'double' }));

        const dataFile = path.join(__dirname, 'data.txt');
        const data = fs.readFileSync(dataFile, 'utf8').split('\n').filter(Boolean);

        const totalGames = await this.askNumber('How many games do you want to play? ', 100);
        const totalBatches = await this.askNumber('How many batches do you want to process (can only 1 batch)? ', data.length);
        const accountsToProcess = data.slice(0, totalBatches);

        for (let i = 0; i < accountsToProcess.length; i++) {
            const initData = accountsToProcess[i];
            await this.processUser(initData, i + 1, totalGames);
        }
    }
}

(async () => {
    const client = new ByBit();
    client.main().catch(err => {
        client.log(err.message, 'warning');
        process.exit(1);
    });
})();
