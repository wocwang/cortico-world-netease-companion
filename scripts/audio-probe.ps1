param(
  [string]$Dir = "$env:TEMP\coopani-netease-audio",
  [int]$ParentPid = 0
)

# Compile C# in a cache directory. Core may point TEMP at its own data\tmp,
# where the C# compiler fails with an unhelpful "cannot add type" error.
$cache = Join-Path $env:LOCALAPPDATA 'CoopaniNeteaseAudio\tmp'
New-Item -ItemType Directory -Force -Path $cache | Out-Null
$env:TEMP = $cache
$env:TMP = $cache

New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$ready = Join-Path $Dir 'capture.ready'
$errorFile = Join-Path $Dir 'capture.error'
Remove-Item -Force -ErrorAction SilentlyContinue $ready, $errorFile

# WASAPI loopback capture, no DLLs and no drivers. The last 30 seconds stay in
# memory; a WAV is written only when capture.request appears. The ring buffer
# and WAV writer are adapted from coopani-world-music (MIT).
$src = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace CoopaniNeteaseAudio
{
    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    public struct WAVEFORMATEX
    {
        public ushort wFormatTag; public ushort nChannels; public uint nSamplesPerSec;
        public uint nAvgBytesPerSec; public ushort nBlockAlign; public ushort wBitsPerSample; public ushort cbSize;
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    internal class MMDeviceEnumerator { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceEnumerator
    {
        int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
        int GetDevice(string id, out IMMDevice device);
        int RegisterEndpointNotificationCallback(IntPtr client);
        int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDevice
    {
        int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        int OpenPropertyStore(int access, out IntPtr props);
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        int GetState(out int state);
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioClient
    {
        int Initialize(int shareMode, int streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
        int GetBufferSize(out uint frames);
        int GetStreamLatency(out long latency);
        int GetCurrentPadding(out uint padding);
        int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
        int GetMixFormat(out IntPtr format);
        int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
        int Start();
        int Stop();
        int Reset();
        int SetEventHandle(IntPtr handle);
        int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioCaptureClient
    {
        int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePos, out ulong qpcPos);
        int ReleaseBuffer(uint frames);
        int GetNextPacketSize(out uint frames);
    }

    public static class Probe
    {
        [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);

        static string _dir;
        static float[] _ring;
        static int _ringPos, _ringCount, _channels = 2, _rate = 48000;
        static readonly object _ringLock = new object();

        static void EnsureRing(int channels, int rate)
        {
            lock (_ringLock)
            {
                _channels = channels;
                _rate = rate;
                int need = channels * rate * 30;
                if (_ring == null || _ring.Length < need)
                {
                    _ring = new float[need];
                    _ringPos = 0;
                    _ringCount = 0;
                }
            }
        }

        static void AppendRing(float[] buffer, int count)
        {
            lock (_ringLock)
            {
                if (_ring == null) return;
                int cap = _ring.Length;
                int pos = _ringPos;
                int first = Math.Min(count, cap - pos);
                Array.Copy(buffer, 0, _ring, pos, first);
                if (count > first) Array.Copy(buffer, first, _ring, 0, count - first);
                _ringPos = (pos + count) % cap;
                _ringCount = Math.Min(cap, _ringCount + count);
            }
        }

        static float[] SnapshotRing(int need)
        {
            lock (_ringLock)
            {
                if (_ring == null || _ringCount == 0) return new float[0];
                int cap = _ring.Length;
                int take = Math.Min(need, _ringCount);
                int start = (_ringPos - take + cap * 2) % cap;
                var copy = new float[take];
                int first = Math.Min(take, cap - start);
                Array.Copy(_ring, start, copy, 0, first);
                if (take > first) Array.Copy(_ring, 0, copy, first, take - first);
                return copy;
            }
        }

        static void MaybeDump()
        {
            string req = Path.Combine(_dir, "capture.request");
            if (!File.Exists(req)) return;
            try
            {
                int seconds = 10;
                try { seconds = Int32.Parse(File.ReadAllText(req).Trim()); } catch { }
                if (seconds < 5) seconds = 5;
                if (seconds > 30) seconds = 30;
                var samples = SnapshotRing(seconds * _rate * _channels);
                if (samples.Length < _rate * _channels * 2) return;
                string wav = Path.Combine(_dir, "capture.wav");
                string tmp = wav + ".tmp";
                WritePcm16(tmp, samples, _channels, _rate);
                if (File.Exists(wav)) File.Delete(wav);
                File.Move(tmp, wav);
                File.Delete(req);
                File.Delete(Path.Combine(_dir, "capture.error"));
            }
            catch
            {
                // Keep the request; the next 100 ms tick retries.
            }
        }

        static void WritePcm16(string path, float[] samples, int channels, int rate)
        {
            using (var fs = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.Read))
            using (var w = new BinaryWriter(fs))
            {
                int dataBytes = samples.Length * 2;
                w.Write(new[] { (byte)'R', (byte)'I', (byte)'F', (byte)'F' });
                w.Write(36 + dataBytes);
                w.Write(new[] { (byte)'W', (byte)'A', (byte)'V', (byte)'E' });
                w.Write(new[] { (byte)'f', (byte)'m', (byte)'t', (byte)' ' });
                w.Write(16);
                w.Write((short)1);
                w.Write((short)channels);
                w.Write(rate);
                w.Write(rate * channels * 2);
                w.Write((short)(channels * 2));
                w.Write((short)16);
                w.Write(new[] { (byte)'d', (byte)'a', (byte)'t', (byte)'a' });
                w.Write(dataBytes);
                for (int i = 0; i < samples.Length; i++)
                {
                    double v = Math.Max(-1.0, Math.Min(1.0, samples[i]));
                    w.Write((short)Math.Round(v * 32767.0));
                }
            }
        }

        static bool ParentAlive(int pid)
        {
            try { var p = Process.GetProcessById(pid); return !p.HasExited; }
            catch { return false; }
        }

        static void Release(ref IAudioClient client, ref IAudioCaptureClient capture, ref IntPtr fmtPtr)
        {
            try { if (client != null) client.Stop(); } catch { }
            if (capture != null && Marshal.IsComObject(capture)) Marshal.ReleaseComObject(capture);
            if (client != null && Marshal.IsComObject(client)) Marshal.ReleaseComObject(client);
            capture = null; client = null;
            if (fmtPtr != IntPtr.Zero) { Marshal.FreeCoTaskMem(fmtPtr); fmtPtr = IntPtr.Zero; }
        }

        public static void Run(string dir, int parentPid)
        {
            _dir = dir;
            try { ShowWindow(GetConsoleWindow(), 0); } catch { }
            Directory.CreateDirectory(dir);
            var sw = Stopwatch.StartNew();
            IAudioClient client = null; IAudioCaptureClient capture = null; IntPtr fmtPtr = IntPtr.Zero;
            float[] buffer = new float[0];
            long lastFrameAt = 0, nextParent = 0, nextDump = 0;

            while (true)
            {
                if (sw.ElapsedMilliseconds >= nextParent)
                {
                    nextParent = sw.ElapsedMilliseconds + 500;
                    if (parentPid > 0 && !ParentAlive(parentPid)) break;
                }

                if (client == null)
                {
                    try
                    {
                        var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
                        IMMDevice device;
                        int hr = enumerator.GetDefaultAudioEndpoint(0, 0, out device);
                        if (hr != 0) { Thread.Sleep(1000); continue; }
                        Guid iidClient = typeof(IAudioClient).GUID;
                        object o;
                        hr = device.Activate(ref iidClient, 1, IntPtr.Zero, out o);
                        if (hr != 0) { Thread.Sleep(1000); continue; }
                        client = (IAudioClient)o;
                        hr = client.GetMixFormat(out fmtPtr);
                        if (hr != 0) { Release(ref client, ref capture, ref fmtPtr); Thread.Sleep(600); continue; }
                        var fmt = (WAVEFORMATEX)Marshal.PtrToStructure(fmtPtr, typeof(WAVEFORMATEX));
                        EnsureRing(fmt.nChannels, (int)fmt.nSamplesPerSec);
                        hr = client.Initialize(0, 0x20000 | 0x80000, 10000000, 0, fmtPtr, IntPtr.Zero);
                        if (hr != 0) { Release(ref client, ref capture, ref fmtPtr); Thread.Sleep(600); continue; }
                        Guid iidCapture = typeof(IAudioCaptureClient).GUID;
                        object cap;
                        hr = client.GetService(ref iidCapture, out cap);
                        if (hr != 0) { Release(ref client, ref capture, ref fmtPtr); Thread.Sleep(600); continue; }
                        capture = (IAudioCaptureClient)cap;
                        client.Start();
                        lastFrameAt = sw.ElapsedMilliseconds;
                        File.WriteAllText(Path.Combine(dir, "capture.ready"), "ready");
                        continue;
                    }
                    catch
                    {
                        Release(ref client, ref capture, ref fmtPtr);
                        Thread.Sleep(1000);
                        continue;
                    }
                }

                uint pending = 0;
                if (capture.GetNextPacketSize(out pending) != 0)
                {
                    Release(ref client, ref capture, ref fmtPtr);
                    continue;
                }

                int guard = 0;
                while (pending > 0 && guard++ < 64)
                {
                    IntPtr data; uint frames, flags; ulong dpos, qpos;
                    if (capture.GetBuffer(out data, out frames, out flags, out dpos, out qpos) != 0)
                    {
                        Release(ref client, ref capture, ref fmtPtr);
                        break;
                    }
                    if (frames > 0)
                    {
                        int need = (int)frames * _channels;
                        if (buffer.Length < need) buffer = new float[need];
                        if (data != IntPtr.Zero && (flags & 0x2) == 0) Marshal.Copy(data, buffer, 0, need);
                        else Array.Clear(buffer, 0, need);
                        AppendRing(buffer, need);
                        lastFrameAt = sw.ElapsedMilliseconds;
                    }
                    capture.ReleaseBuffer(frames);
                    if (capture.GetNextPacketSize(out pending) != 0) break;
                }

                if (client != null && sw.ElapsedMilliseconds - lastFrameAt > 2000)
                {
                    Release(ref client, ref capture, ref fmtPtr);
                    continue;
                }

                if (sw.ElapsedMilliseconds >= nextDump)
                {
                    nextDump = sw.ElapsedMilliseconds + 100;
                    MaybeDump();
                }
                Thread.Sleep(10);
            }

            Release(ref client, ref capture, ref fmtPtr);
        }
    }
}
'@

try {
  Add-Type -TypeDefinition $src -Language CSharp
  [CoopaniNeteaseAudio.Probe]::Run($Dir, $ParentPid)
} catch {
  try { Set-Content -Path $errorFile -Value $_.Exception.Message -Encoding UTF8 } catch { }
  exit 1
}
