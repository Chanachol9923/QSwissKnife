// QSwissKnife setup & uninstaller (C# 5 / .NET Framework 4.8 WinForms, built by launcher/package.ps1).
//
// The same source builds two programs:
//   QSwissKnife-Setup.exe — carries the app as an embedded payload.zip and installs it per-user
//                           (no admin): files, shortcuts, an Apps & features entry, optional yt-dlp/FFmpeg.
//   uninstall.exe         — no payload; removes everything the setup created.
//
// Quiet use:  QSwissKnife-Setup.exe /S [/D=<folder>] [/NoDesktop] [/NoStartMenu] [/YouTube] [/NoLaunch]
//             uninstall.exe /S [/KeepData]
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("QSwissKnife Setup")]
[assembly: AssemblyProduct("QSwissKnife")]
[assembly: AssemblyCompany("AnnoyingDoggo")]
[assembly: AssemblyCopyright("by AnnoyingDoggo")]
[assembly: AssemblyVersion(QSwissKnifeSetup.Info.Version)]
[assembly: AssemblyFileVersion(QSwissKnifeSetup.Info.Version)]

namespace QSwissKnifeSetup
{
    static class Info
    {
        public const string Version = "1.1.0.0";
        public const string DisplayVersion = "1.1.0";
        public const string Name = "QSwissKnife";
        public const string Publisher = "AnnoyingDoggo";
        public const string Repo = "https://github.com/Chanachol9923/QSwissKnife";
        public const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\QSwissKnife";

        public static string DefaultDir { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", Name); } }
        public static string DataDir { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Name); } }
        public static string DesktopLink { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Name + ".lnk"); } }
        public static string StartLink { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Name + ".lnk"); } }

        public static Stream Payload { get { return Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"); } }

        public static bool Has(string[] args, string flag) { return args.Any(a => a.Equals(flag, StringComparison.OrdinalIgnoreCase)); }
        public static string Value(string[] args, string prefix)
        {
            var a = args.FirstOrDefault(x => x.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));
            return a == null ? null : a.Substring(prefix.Length).Trim('"');
        }
    }

    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var quiet = Info.Has(args, "/S");
            bool isSetup;
            using (var p = Info.Payload) isSetup = p != null;

            if (!isSetup) return Uninstaller.Run(quiet, !Info.Has(args, "/KeepData"));
            if (!quiet)
            {
                Application.Run(new SetupForm());
                return 0;
            }
            var opts = new Options
            {
                Dir = Info.Value(args, "/D=") ?? Info.DefaultDir,
                Desktop = !Info.Has(args, "/NoDesktop"),
                StartMenu = !Info.Has(args, "/NoStartMenu"),
                YouTube = Info.Has(args, "/YouTube"),
                Launch = !Info.Has(args, "/NoLaunch"),
            };
            try
            {
                Installer.Run(opts, (pct, msg) => Console.WriteLine(pct + "% " + msg));
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex.Message);
                return 1;
            }
        }
    }

    class Options
    {
        public string Dir;
        public bool Desktop, StartMenu, YouTube, Launch;
    }

    /* ------------------------------------------------------------------ */
    /* Install                                                             */
    /* ------------------------------------------------------------------ */

    static class Installer
    {
        public static void Run(Options o, Action<int, string> report)
        {
            var dir = Path.GetFullPath(o.Dir);
            report(2, "Closing QSwissKnife if it's running…");
            Shared.StopRunning(dir);

            // clean upgrade: replace program files, never touch user data (that lives in %LOCALAPPDATA%\QSwissKnife)
            foreach (var sub in new[] { "app", "server", "node" })
            {
                var d = Path.Combine(dir, sub);
                if (Directory.Exists(d)) Directory.Delete(d, true);
            }
            Directory.CreateDirectory(dir);

            using (var stream = Info.Payload)
            using (var zip = new ZipArchive(stream, ZipArchiveMode.Read))
            {
                long total = zip.Entries.Sum(e => e.Length), done = 0;
                foreach (var e in zip.Entries)
                {
                    var target = Path.GetFullPath(Path.Combine(dir, e.FullName));
                    if (!target.StartsWith(dir + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) continue; // zip-slip guard
                    if (e.FullName.EndsWith("/")) { Directory.CreateDirectory(target); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    using (var src = e.Open())
                    using (var dst = File.Create(target)) src.CopyTo(dst);
                    done += e.Length;
                    report(5 + (int)(80 * done / Math.Max(1, total)), "Copying " + e.Name);
                }
            }

            var exe = Path.Combine(dir, "QSwissKnife.exe");
            var ico = Path.Combine(dir, "qswissknife.ico");
            report(87, "Creating shortcuts…");
            if (o.StartMenu) Shared.CreateShortcut(Info.StartLink, exe, ico, dir);
            if (o.Desktop) Shared.CreateShortcut(Info.DesktopLink, exe, ico, dir);

            report(90, "Registering in Apps & features…");
            using (var k = Registry.CurrentUser.CreateSubKey(Info.UninstallKey))
            {
                var un = Path.Combine(dir, "uninstall.exe");
                k.SetValue("DisplayName", Info.Name);
                k.SetValue("DisplayVersion", Info.DisplayVersion);
                k.SetValue("Publisher", Info.Publisher);
                k.SetValue("DisplayIcon", exe);
                k.SetValue("InstallLocation", dir);
                k.SetValue("UninstallString", "\"" + un + "\"");
                k.SetValue("QuietUninstallString", "\"" + un + "\" /S");
                k.SetValue("URLInfoAbout", Info.Repo);
                k.SetValue("HelpLink", Info.Repo);
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                k.SetValue("EstimatedSize", (int)(Shared.DirSize(dir) / 1024), RegistryValueKind.DWord);
                k.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
            }

            if (o.YouTube)
            {
                if (!Shared.OnPath("yt-dlp.exe")) { report(92, "Installing yt-dlp (YouTube support)…"); Shared.Winget("yt-dlp.yt-dlp"); }
                if (!Shared.OnPath("ffmpeg.exe")) { report(95, "Installing FFmpeg (YouTube support)…"); Shared.Winget("Gyan.FFmpeg"); }
            }

            report(100, "Done");
            if (o.Launch) Process.Start(new ProcessStartInfo(exe) { UseShellExecute = true, WorkingDirectory = dir });
        }
    }

    /* ------------------------------------------------------------------ */
    /* Uninstall                                                           */
    /* ------------------------------------------------------------------ */

    static class Uninstaller
    {
        public static int Run(bool quiet, bool deleteData)
        {
            var dir = Path.GetDirectoryName(Application.ExecutablePath);
            if (!quiet)
            {
                if (MessageBox.Show("Remove QSwissKnife from this computer?", "Uninstall QSwissKnife", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return 1;
                deleteData = MessageBox.Show("Also delete your QSwissKnife settings (favorites, theme, window size)?", "Uninstall QSwissKnife", MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes;
            }
            Shared.StopRunning(dir);

            foreach (var link in new[] { Info.DesktopLink, Info.StartLink })
                if (File.Exists(link) && Shared.ShortcutTarget(link).StartsWith(dir, StringComparison.OrdinalIgnoreCase)) File.Delete(link);
            Registry.CurrentUser.DeleteSubKeyTree(Info.UninstallKey, false);

            var self = Application.ExecutablePath;
            foreach (var f in Directory.GetFiles(dir)) if (!f.Equals(self, StringComparison.OrdinalIgnoreCase)) Shared.TryDelete(f);
            foreach (var d in Directory.GetDirectories(dir)) { try { Directory.Delete(d, true); } catch { } }
            if (deleteData && Directory.Exists(Info.DataDir)) { try { Directory.Delete(Info.DataDir, true); } catch { } }

            // a running exe can't delete itself: let cmd remove it (and the folder) once we've exited
            Process.Start(new ProcessStartInfo("cmd.exe", "/c ping 127.0.0.1 -n 3 > nul & del /f /q \"" + self + "\" & rmdir /q \"" + dir + "\"")
            { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden });

            if (!quiet) MessageBox.Show("QSwissKnife was removed.", "Uninstall QSwissKnife", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Helpers                                                             */
    /* ------------------------------------------------------------------ */

    static class Shared
    {
        /// <summary>Close the app and its bundled server if they run from this folder.</summary>
        public static void StopRunning(string dir)
        {
            foreach (var name in new[] { "QSwissKnife", "node" })
                foreach (var p in Process.GetProcessesByName(name))
                {
                    try
                    {
                        if (!p.MainModule.FileName.StartsWith(dir, StringComparison.OrdinalIgnoreCase)) continue;
                        if (name == "QSwissKnife" && p.CloseMainWindow() && p.WaitForExit(4000)) continue;
                        p.Kill();
                        p.WaitForExit(4000);
                    }
                    catch { /* not ours / already gone / access denied */ }
                }
        }

        static object Shell() { return Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")); }
        static object Call(object o, string m, params object[] a) { return o.GetType().InvokeMember(m, BindingFlags.InvokeMethod, null, o, a); }
        static object Get(object o, string p) { return o.GetType().InvokeMember(p, BindingFlags.GetProperty, null, o, null); }
        static void Set(object o, string p, object v) { o.GetType().InvokeMember(p, BindingFlags.SetProperty, null, o, new[] { v }); }

        public static void CreateShortcut(string path, string target, string icon, string workDir)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            var s = Call(Shell(), "CreateShortcut", path);
            Set(s, "TargetPath", target);
            Set(s, "WorkingDirectory", workDir);
            Set(s, "IconLocation", icon + ",0");
            Set(s, "Description", "Convert, compress, crop and trim files — by AnnoyingDoggo");
            Call(s, "Save");
        }

        public static string ShortcutTarget(string path)
        {
            try { return (string)Get(Call(Shell(), "CreateShortcut", path), "TargetPath") ?? ""; }
            catch { return ""; }
        }

        public static long DirSize(string dir)
        {
            return new DirectoryInfo(dir).EnumerateFiles("*", SearchOption.AllDirectories).Sum(f => f.Length);
        }

        public static void TryDelete(string f) { try { File.Delete(f); } catch { } }

        public static bool OnPath(string exe)
        {
            var path = Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.Machine) + ";" + Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.User);
            return path.Split(';').Any(d => { try { return d.Length > 0 && File.Exists(Path.Combine(Environment.ExpandEnvironmentVariables(d), exe)); } catch { return false; } });
        }

        public static string WingetPath()
        {
            var p = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "WindowsApps", "winget.exe");
            return File.Exists(p) ? p : null;
        }

        public static void Winget(string id)
        {
            var w = WingetPath();
            if (w == null) throw new Exception("winget isn't available, so YouTube support couldn't be installed automatically. Install yt-dlp and FFmpeg manually (see the README).");
            var psi = new ProcessStartInfo(w, "install --id " + id + " -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity")
            { UseShellExecute = false, CreateNoWindow = true };
            using (var p = Process.Start(psi))
            {
                p.WaitForExit();
                // -1978335189 = "already installed" — that's fine
                if (p.ExitCode != 0 && p.ExitCode != -1978335189) throw new Exception("winget couldn't install " + id + " (exit code " + p.ExitCode + ").");
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* Setup window                                                        */
    /* ------------------------------------------------------------------ */

    class SetupForm : Form
    {
        static readonly Color Bg = Color.FromArgb(17, 20, 25), Panel = Color.FromArgb(24, 28, 34), Border = Color.FromArgb(50, 58, 72);
        static readonly Color Text1 = Color.FromArgb(232, 234, 240), Muted = Color.FromArgb(139, 147, 167), Accent = Color.FromArgb(139, 116, 255);

        readonly TextBox dirBox = new TextBox();
        readonly CheckBox desktop = new CheckBox(), startMenu = new CheckBox(), youtube = new CheckBox(), launch = new CheckBox();
        readonly ProgressBar bar = new ProgressBar();
        readonly Label status = new Label();
        readonly Button install = new Button(), cancel = new Button(), browse = new Button();
        bool busy, finished;

        public SetupForm()
        {
            Text = "QSwissKnife Setup";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(560, 430);
            BackColor = Bg;
            ForeColor = Text1;
            Font = new Font("Segoe UI", 9.5f);
            var logo = new PictureBox { Location = new Point(28, 26), Size = new Size(56, 56), SizeMode = PictureBoxSizeMode.Zoom };
            try
            {
                var asm = Assembly.GetExecutingAssembly();
                using (var s = asm.GetManifestResourceStream("icon.ico")) Icon = new Icon(s);
                // the logo is a PNG: GDI+ draws PNG-compressed .ico frames as noise
                using (var s = asm.GetManifestResourceStream("logo.png")) logo.Image = new Bitmap(Image.FromStream(s));
            }
            catch { }
            Controls.Add(logo);
            Controls.Add(Lbl("QSwissKnife", 98, 26, new Font("Segoe UI Semibold", 17f), Text1));
            Controls.Add(Lbl("by AnnoyingDoggo  ·  version " + Info.DisplayVersion, 100, 60, Font, Muted));
            Controls.Add(Lbl("Convert, compress, crop and trim images, video, audio and PDFs.", 28, 100, Font, Muted, 504));

            Controls.Add(Lbl("Install to", 28, 140, new Font("Segoe UI Semibold", 9.5f), Text1));
            dirBox.Text = Info.DefaultDir;
            dirBox.Location = new Point(28, 164);
            dirBox.Size = new Size(410, 26);
            dirBox.BackColor = Panel;
            dirBox.ForeColor = Text1;
            dirBox.BorderStyle = BorderStyle.FixedSingle;
            Controls.Add(dirBox);
            Style(browse, "Browse…", false);
            browse.Location = new Point(446, 162);
            browse.Size = new Size(86, 29);
            browse.Click += (s, e) =>
            {
                using (var d = new FolderBrowserDialog { Description = "Choose where to install QSwissKnife", SelectedPath = dirBox.Text })
                    if (d.ShowDialog(this) == DialogResult.OK) dirBox.Text = Path.Combine(d.SelectedPath, d.SelectedPath.EndsWith(Info.Name) ? "" : Info.Name);
            };
            Controls.Add(browse);

            var hasYt = Shared.OnPath("yt-dlp.exe") && Shared.OnPath("ffmpeg.exe");
            var y = 206;
            Check(desktop, "Create a Desktop shortcut", true, ref y);
            Check(startMenu, "Add to the Start Menu", true, ref y);
            if (hasYt)
            {
                youtube.Enabled = false;
                Controls.Add(Lbl("\u2713  YouTube Downloader support: yt-dlp and FFmpeg found", 30, y + 2, Font, Color.FromArgb(52, 211, 153)));
                y += 28;
            }
            else if (Shared.WingetPath() == null)
            {
                youtube.Enabled = false;
                Controls.Add(Lbl("YouTube Downloader needs yt-dlp + FFmpeg - install them later (see README)", 30, y + 2, Font, Muted));
                y += 28;
            }
            else Check(youtube, "Install YouTube Downloader support (yt-dlp + FFmpeg via winget, ~150 MB)", true, ref y);
            Check(launch, "Open QSwissKnife when setup finishes", true, ref y);

            bar.Location = new Point(28, 340);
            bar.Size = new Size(504, 6);
            bar.Visible = false;
            Controls.Add(bar);
            status.Location = new Point(28, 316);
            status.Size = new Size(504, 20);
            status.ForeColor = Muted;
            Controls.Add(status);

            Style(install, "Install", true);
            install.Location = new Point(336, 372);
            install.Size = new Size(110, 36);
            install.Click += async (s, e) => await OnInstall();
            Controls.Add(install);
            Style(cancel, "Cancel", false);
            cancel.Location = new Point(452, 372);
            cancel.Size = new Size(80, 36);
            cancel.Click += (s, e) => Close();
            Controls.Add(cancel);
            AcceptButton = install;
            ActiveControl = install;
            FormClosing += (s, e) => { if (busy) e.Cancel = true; };
            HandleCreated += (s, e) =>
            {
                // dark title bar (Windows 10 2004+ / 11); harmless where unsupported
                var on = 1;
                try { DwmSetWindowAttribute(Handle, 20, ref on, 4); } catch { }
            };
        }

        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        static Label Lbl(string text, int x, int y, Font f, Color c, int width = 0)
        {
            var l = new Label { Text = text, Location = new Point(x, y), Font = f, ForeColor = c, AutoSize = width == 0, BackColor = Color.Transparent };
            if (width > 0) l.Size = new Size(width, 40);
            return l;
        }

        void Check(CheckBox c, string text, bool on, ref int y)
        {
            c.Text = text;
            c.Checked = on;
            c.Location = new Point(30, y);
            c.AutoSize = true;
            c.ForeColor = Text1;
            Controls.Add(c);
            y += 28;
        }

        static void Style(Button b, string text, bool primary)
        {
            b.Text = text;
            b.FlatStyle = FlatStyle.Flat;
            b.FlatAppearance.BorderColor = primary ? Accent : Border;
            b.FlatAppearance.BorderSize = 1;
            b.BackColor = primary ? Accent : Panel;
            b.ForeColor = primary ? Color.White : Text1;
            b.Font = new Font("Segoe UI Semibold", 9.5f);
            b.Cursor = Cursors.Hand;
        }

        async Task OnInstall()
        {
            if (finished) { Close(); return; }
            var o = new Options { Dir = dirBox.Text.Trim(), Desktop = desktop.Checked, StartMenu = startMenu.Checked, YouTube = youtube.Enabled && youtube.Checked, Launch = launch.Checked };
            if (o.Dir.Length == 0) return;
            busy = true;
            foreach (Control c in Controls) if (c is CheckBox || c is Button || c is TextBox) c.Enabled = false;
            bar.Visible = true;
            string error = null;
            var ui = SynchronizationContext.Current;
            await Task.Run(() =>
            {
                try { Installer.Run(o, (pct, msg) => ui.Post(_ => { bar.Value = Math.Min(100, pct); status.Text = msg; }, null)); }
                catch (Exception ex) { error = ex.Message; }
            });
            busy = false;
            if (error != null)
            {
                status.ForeColor = Color.FromArgb(248, 113, 113);
                status.Text = "Setup failed: " + error;
                install.Text = "Close";
                finished = true;
                install.Enabled = true;
                return;
            }
            status.ForeColor = Color.FromArgb(52, 211, 153);
            status.Text = o.Launch ? "QSwissKnife is installed and opening now." : "QSwissKnife is installed. Find it in the Start Menu or on your Desktop.";
            install.Text = "Finish";
            install.Enabled = true;
            cancel.Visible = false;
            finished = true;
        }
    }
}
