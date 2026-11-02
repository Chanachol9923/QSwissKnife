// QSwiftKnife.exe — a small native window that hosts the app in WebView2 (the Edge engine built
// into Windows). Because the window belongs to this exe rather than to Edge, Windows gives it its own
// taskbar button and icon, and pinning it works like any other program.
//
// Built by launcher/build-exe.ps1 (C# 5 / .NET Framework 4.8, no SDK needed).
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace QSwiftKnife
{
    static class Program
    {
        public const string Url = "http://127.0.0.1:4317/";

        [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
        [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);

        [STAThread]
        static void Main()
        {
            bool first;
            using (var mutex = new Mutex(true, "QSwiftKnife.SingleInstance", out first))
            {
                if (!first) { FocusExisting(); return; }
                try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); } // per-monitor v2
                catch (EntryPointNotFoundException) { SetProcessDPIAware(); }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainForm());
            }
        }

        static void FocusExisting()
        {
            var me = Process.GetCurrentProcess();
            foreach (var p in Process.GetProcessesByName(me.ProcessName))
            {
                if (p.Id == me.Id || p.MainWindowHandle == IntPtr.Zero) continue;
                if (IsIconic(p.MainWindowHandle)) ShowWindow(p.MainWindowHandle, 9 /* SW_RESTORE */);
                SetForegroundWindow(p.MainWindowHandle);
                return;
            }
        }

        /// <summary>launcher\bin\QSwiftKnife.exe → project root</summary>
        public static string Root { get { return Path.GetFullPath(Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "..", "..")); } }
        public static string Launcher { get { return Path.Combine(Root, "launcher"); } }
        public static string DataDir
        {
            get
            {
                var d = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "QSwiftKnife");
                Directory.CreateDirectory(d);
                return d;
            }
        }
    }

    class MainForm : Form
    {
        readonly WebView2 web = new WebView2();
        static readonly Color Bg = Color.FromArgb(10, 12, 16);
        string PlacementFile { get { return Path.Combine(Program.DataDir, "window.txt"); } }

        public MainForm()
        {
            Text = "QSwiftKnife";
            BackColor = Bg;
            StartPosition = FormStartPosition.Manual;
            var ico = Path.Combine(Program.Launcher, "qswiftknife.ico");
            Icon = File.Exists(ico) ? new Icon(ico) : Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            RestorePlacement();
            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = Bg;
            Controls.Add(web);
            Load += async (s, e) => await StartAsync();
            FormClosing += (s, e) => SavePlacement();
        }

        async Task StartAsync()
        {
            try
            {
                var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.DataDir, "WebView2"));
                await web.EnsureCoreWebView2Async(env);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Couldn't start the WebView2 engine:\n" + ex.Message + "\n\nInstall the Microsoft Edge WebView2 Runtime and try again.", "QSwiftKnife", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
                return;
            }

            var core = web.CoreWebView2;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = true;
            core.DocumentTitleChanged += (s, e) =>
            {
                var t = core.DocumentTitle;
                Text = string.IsNullOrEmpty(t) || t.StartsWith("about:") || t.StartsWith("data:") ? "QSwiftKnife" : t;
            };
            // links that open a new tab (e.g. "Open on YouTube") go to the normal browser
            core.NewWindowRequested += (s, e) => { e.Handled = true; OpenExternal(e.Uri); };
            core.NavigationStarting += (s, e) =>
            {
                if (e.Uri.StartsWith(Program.Url) || e.Uri.StartsWith("data:") || e.Uri.StartsWith("about:")) return;
                e.Cancel = true;
                OpenExternal(e.Uri);
            };

            if (!ServerUp())
            {
                core.NavigateToString(Splash("Starting QSwiftKnife…", "Building and starting the local server. This takes a few seconds the first time.", false));
                var error = await Task.Run(() => StartServer());
                if (error != null)
                {
                    core.NavigateToString(Splash("QSwiftKnife couldn't start", error, true));
                    return;
                }
            }
            core.Navigate(Program.Url);
        }

        static void OpenExternal(string uri)
        {
            if (uri.StartsWith("http://") || uri.StartsWith("https://")) Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true });
        }

        static bool ServerUp()
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(Program.Url + "api/yt/health");
                req.Timeout = 1500;
                req.Proxy = null;
                using (var res = (HttpWebResponse)req.GetResponse()) return res.StatusCode == HttpStatusCode.OK;
            }
            catch { return false; }
        }

        /// <summary>Runs start.ps1 -ServerOnly (build if needed + start hidden server). Returns an error message or null.</summary>
        static string StartServer()
        {
            var script = Path.Combine(Program.Launcher, "start.ps1");
            // Errors come back through a file, not stdout: the long-running server inherits the
            // script's handles, so a redirected pipe would never reach end-of-stream.
            var errFile = Path.Combine(Program.DataDir, "launch-error.txt");
            if (File.Exists(errFile)) File.Delete(errFile);
            var psi = new ProcessStartInfo("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + script + "\" -ServerOnly -ErrorFile \"" + errFile + "\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = Program.Root,
            };
            using (var p = Process.Start(psi))
            {
                p.WaitForExit();
                if (p.ExitCode == 0 && ServerUp()) return null;
                var msg = File.Exists(errFile) ? File.ReadAllText(errFile).Trim() : "";
                return string.IsNullOrEmpty(msg) ? "The local server didn't start. See launcher\\server.log.err" : msg;
            }
        }

        static string Splash(string title, string detail, bool error)
        {
            var enc = new Func<string, string>(t => WebUtility.HtmlEncode(t).Replace("\n", "<br>"));
            return "<!doctype html><html><head><meta charset='utf-8'><title>QSwiftKnife</title><style>" +
                "body{margin:0;height:100vh;display:grid;place-items:center;background:#0a0c10;color:#e8eaf0;font:15px 'Segoe UI',system-ui,sans-serif}" +
                ".b{text-align:center;max-width:520px;padding:24px}.s{width:34px;height:34px;margin:0 auto 18px;border-radius:50%;border:3px solid #2a2f3b;border-top-color:#8b74ff;animation:r .9s linear infinite}" +
                "@keyframes r{to{transform:rotate(360deg)}}h1{font-size:18px;margin:0 0 8px}p{color:#8b93a7;margin:0;line-height:1.5}" +
                ".e{color:#f87171;font-family:Consolas,monospace;font-size:12.5px;text-align:left;background:#171b22;padding:12px;border-radius:8px;margin-top:12px;white-space:pre-wrap}" +
                "</style></head><body><div class='b'>" + (error ? "" : "<div class='s'></div>") + "<h1>" + enc(title) + "</h1>" +
                (error ? "<div class='e'>" + enc(detail) + "</div>" : "<p>" + enc(detail) + "</p>") + "</div></body></html>";
        }

        void RestorePlacement()
        {
            var area = Screen.PrimaryScreen.WorkingArea;
            var w = Math.Min(area.Width - 80, (int)(area.Width * 0.78));
            var h = Math.Min(area.Height - 60, (int)(area.Height * 0.86));
            Bounds = new Rectangle(area.Left + (area.Width - w) / 2, area.Top + (area.Height - h) / 2, w, h);
            try
            {
                var parts = File.ReadAllText(PlacementFile).Split(',');
                var r = new Rectangle(int.Parse(parts[0]), int.Parse(parts[1]), int.Parse(parts[2]), int.Parse(parts[3]));
                // only restore if it's still on a connected screen
                foreach (var s in Screen.AllScreens)
                    if (s.WorkingArea.IntersectsWith(r) && r.Width > 300 && r.Height > 200) { Bounds = r; break; }
                if (parts.Length > 4 && parts[4] == "max") WindowState = FormWindowState.Maximized;
            }
            catch { /* first run or unreadable — keep the default */ }
        }

        void SavePlacement()
        {
            try
            {
                var r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
                File.WriteAllText(PlacementFile, r.X + "," + r.Y + "," + r.Width + "," + r.Height + "," + (WindowState == FormWindowState.Maximized ? "max" : "normal"));
            }
            catch { /* non-critical */ }
        }
    }
}
