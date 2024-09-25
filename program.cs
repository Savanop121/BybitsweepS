using System;
using System.IO;
using System.Threading.Tasks;
using System.Net.Http;
using System.Net.Http.Headers;
using Newtonsoft.Json.Linq;

class ByBit
{
    private HttpClient client;
    private string accessToken;
    private string initData;
    private const string baseUrl = "https://api.bybitcoinsweeper.com";

    public ByBit()
    {
        client = new HttpClient();
        client.BaseAddress = new Uri(baseUrl);
        client.DefaultRequestHeaders.Add("authority", "api.bybitcoinsweeper.com");
        client.DefaultRequestHeaders.Add("accept", "*/*");
        client.DefaultRequestHeaders.Add("accept-language", "en-US,en;q=0.9");
        client.DefaultRequestHeaders.Add("origin", "https://bybitcoinsweeper.com");
        client.DefaultRequestHeaders.Add("referer", "https://bybitcoinsweeper.com/");
        client.DefaultRequestHeaders.Add("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36");
    }

    private void Log(string message, string type = "info", bool bold = false)
    {
        var timestamp = DateTime.Now.ToString("HH:mm:ss");
        string icon = type == "info" ? "🟢" : type == "success" ? "🔵" : "🟡";
        Console.ForegroundColor = type == "info" ? ConsoleColor.Green : type == "success" ? ConsoleColor.Cyan : ConsoleColor.Yellow;
        
        if (bold)
        {
            Console.Write($"{icon} [{timestamp}] ");
            Console.BackgroundColor = Console.ForegroundColor;
            Console.ForegroundColor = ConsoleColor.Black;
            Console.Write(message);
            Console.ResetColor();
            Console.WriteLine();
        }
        else
        {
            Console.WriteLine($"{icon} [{timestamp}] {message}");
        }
        
        Console.ResetColor();
    }

    private async Task<JObject> RequestAsync(HttpMethod method, string url, JObject data = null)
    {
        var request = new HttpRequestMessage(method, url);
        if (method == HttpMethod.Post && data != null)
        {
            request.Content = new StringContent(data.ToString(), System.Text.Encoding.UTF8, "application/json");
        }

        try
        {
            var response = await client.SendAsync(request);
            response.EnsureSuccessStatusCode();
            var content = await response.Content.ReadAsStringAsync();
            return JObject.Parse(content);
        }
        catch (HttpRequestException ex)
        {
            Log($"Request error: {ex.Message}", "warning");
            return null;
        }
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

    private async Task<JObject> GetUserInfoAsync()
    {
        var response = await RequestAsync(HttpMethod.Get, "/api/users/me");
        if (response != null)
        {
            return response;
        }

        Log("Failed to get user info", "warning");
        return null;
    }

    public async Task MainAsync()
    {
        Console.WriteLine("=========================");
        Console.WriteLine("    ByBit User Info");
        Console.WriteLine("=========================");

        string[] data = File.ReadAllLines("query.txt");
        if (data.Length == 0)
        {
            Log("No initData found in query.txt", "warning");
            return;
        }

        var loginResult = await LoginAsync(data[0]);
        if (!loginResult) return;

        while (true)
        {
            var userInfo = await GetUserInfoAsync();
            if (userInfo != null)
            {
                string firstName = userInfo["firstName"].ToString();
                int score = int.Parse(userInfo["score"].ToString());
                string bybitId = userInfo["bybitId"].ToString();

                Console.WriteLine(new string('-', 40));
                Log($"User Info:", "info");
                Log($"Name: {firstName}", "info");
                Log($"Score: {score}", "info", true);  // This line is now bold
                Log($"ByBit ID: {bybitId}", "info");
                Console.WriteLine(new string('-', 40));
            }

            await Task.Delay(TimeSpan.FromMinutes(5));
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