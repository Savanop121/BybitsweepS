﻿using System;
using System.IO;
using System.Threading.Tasks;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using Newtonsoft.Json.Linq;
using ConsoleTables;
using Figgle;

class ByBit
{
    private HttpClient client;
    private dynamic game;
    private dynamic user_info;
    private string accessToken;
    private string initData;
    private const string baseUrl = "https://api.bybitcoinsweeper.com";

    public ByBit()
    {
        client = new HttpClient();
        client.BaseAddress = new Uri(baseUrl);
        client.DefaultRequestHeaders.Add("authority", "api.bybitcoinsweeper.com");
        client.DefaultRequestHeaders.Add("accept", "*/*");
        client.DefaultRequestHeaders.Add("accept-encoding", "gzip, deflate, br, zstd");
        client.DefaultRequestHeaders.Add("accept-language", "en-US,en;q=0.9,vi;q=0.8");
        client.DefaultRequestHeaders.Add("clienttype", "web");
        client.DefaultRequestHeaders.Add("lang", "en");
        client.DefaultRequestHeaders.Add("origin", "https://bybitcoinsweeper.com");
        client.DefaultRequestHeaders.Add("referer", "https://bybitcoinsweeper.com/");
        client.DefaultRequestHeaders.Add("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36");
    }

    private void Log(string message, string type = "info")
    {
        var timestamp = DateTime.Now.ToString("HH:mm:ss");
        string icon = type == "info" ? "🟢" : type == "success" ? "🔵" : "🟡";
        Console.ForegroundColor = type == "info" ? ConsoleColor.Green : type == "success" ? ConsoleColor.Cyan : ConsoleColor.Yellow;
        Console.WriteLine($"{icon} [{timestamp}] {message}");
        Console.ResetColor();
    }

    private async Task WaitAsync(int seconds)
    {
        for (int i = seconds; i > 0; i--)
        {
            Console.Write($"\rWaiting {i} seconds...");
            await Task.Delay(1000);
        }
        Console.WriteLine();
    }

    private async Task<JObject> RequestAsync(HttpMethod method, string url, JObject data = null, int retryCount = 0)
    {
        var request = new HttpRequestMessage(method, url);
        if (method == HttpMethod.Post && data != null)
        {
            request.Content = new StringContent(data.ToString(), Encoding.UTF8, "application/json");
        }

        try
        {
            var response = await client.SendAsync(request);
            response.EnsureSuccessStatusCode();
        
            var content = await response.Content.ReadAsStringAsync();

            if (string.IsNullOrEmpty(content))
            {
                Log("Empty response from server.", "warning");
                return null;
            }

            try
            {
                return JObject.Parse(content);
            }
            catch (Newtonsoft.Json.JsonReaderException)
            {
                Log("Failed to parse response as JSON.", "warning");
                return null;
            }
        }
        catch (HttpRequestException ex) when (ex.Message.Contains("429") && retryCount < 3)
        {
            Log("Too many requests, waiting before retrying...", "warning");
            await WaitAsync(60);
            return await RequestAsync(method, url, data, retryCount + 1);
        }
        catch (HttpRequestException ex) when (ex.Message.Contains("401") && retryCount < 1)
        {
            Log("Token might be expired. Attempting to relogin...", "warning");
            var loginResult = await LoginAsync(initData);
            if (loginResult)
            {
                Log("Relogin successful. Retrying the original request...", "info");
                return await RequestAsync(method, url, data, retryCount + 1);
            }
        }
        catch (HttpRequestException ex)
        {
            Log($"Request error: {ex.Message}", "warning");
        }

        return null;
    }

    private async Task<bool> LoginAsync(string initData)
    {
        this.initData = initData;
        var payload = new JObject { { "initData", initData } };

        Log("Attempting to log in with initData", "info");

        var response = await RequestAsync(HttpMethod.Post, "/api/auth/login", payload);
        if (response != null)
        {
            accessToken = response["accessToken"].ToString();
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            client.DefaultRequestHeaders.Add("tl-init-data", initData);
            Log("Login successful, token received", "success");
            return true;
        }

        Log("Login failed", "warning");
        return false;
    }

    private async Task<bool> MeAsync()
    {
        var response = await RequestAsync(HttpMethod.Get, "/api/users/me");
        if (response != null)
        {
            user_info = response;
        
            string firstName = user_info["firstName"].ToString();
            int score = int.Parse(user_info["score"].ToString());
            string bybitId = user_info["bybitId"].ToString();

            Log($"User Info: {firstName}, Score: {score}, ByBit ID: {bybitId}", "info");
            return true;
        }

        Log("Failed to get user info", "warning");
        return false;
    }

    private async Task<bool> StartGameAsync()
    {
        var response = await RequestAsync(HttpMethod.Post, "/api/games/start", new JObject());
        if (response != null)
        {
            game = response;
            return true;
        }

        Log("Failed to start game", "warning");
        return false;
    }

    private async Task<bool> WinGameAsync(int score, int gameTime)
    {
        var data = new JObject
        {
            { "bagCoins", game["rewards"]["bagCoins"] },
            { "bits", game["rewards"]["bits"] },
            { "gifts", game["rewards"]["gifts"] },
            { "gameId", game["id"] },
            { "score", score },
            { "gameTime", gameTime }
        };

        var response = await RequestAsync(HttpMethod.Post, "/api/games/win", data);
        return response != null;
    }

    public async Task ProcessUserAsync(string initData, int batchNumber, int numberOfGames)
    {
        Log($"Batch {batchNumber} processing", "info");

        var loginResult = await LoginAsync(initData);
        if (!loginResult) return;

        var meResult = await MeAsync();
        if (!meResult) return;

        Log($"Processing account for {user_info["firstName"]}", "info");

        int totalScore = 0, successCount = 0, failureCount = 0;
        int batchSize = 1;
        int totalBatches = (int)Math.Ceiling((double)numberOfGames / batchSize);

        for (int batch = 0; batch < totalBatches; batch++)
        {
            int gameTime = new Random().Next(90, 200);
            int score = new Random().Next(600, 900);

            var start = await StartGameAsync();
            if (!start) return;

            await WaitAsync(gameTime);

            var win = await WinGameAsync(score, gameTime);
            if (win)
            {
                totalScore += score;
                successCount++;
            }
            else
            {
                failureCount++;
            }

            Log($"Batch {batch + 1} completed. Total Score: {totalScore}, Successes: {successCount}, Failures: {failureCount}", "success");

            if (batch < totalBatches - 1)
            {
                await WaitAsync(3);
            }
        }

        Log("Account processing completed.", "success");
    }

    public async Task MainAsync()
    {
        Console.WriteLine(FiggleFonts.Standard.Render("ByBit Coin Sweeper"));

        string[] data = File.ReadAllLines("query.txt");
        Console.Write("How many games do you want to play? ");
        int totalGames = int.Parse(Console.ReadLine());
        Console.Write("How many batches do you want to process (can only 1 batch)? ");
        int totalBatches = int.Parse(Console.ReadLine());

        for (int i = 0; i < totalBatches; i++)
        {
            await ProcessUserAsync(data[i], i + 1, totalGames);
        }
    }
}

class Program
{
    static async Task Main(string[] args)
    {
        ByBit byBit = new ByBit();
        await byBit.MainAsync();
    }
}
