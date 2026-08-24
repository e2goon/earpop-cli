//! Capture mic audio as 16 kHz mono s16le frames on stdout (100 ms each).
//!
//! Resampling matches the desktop app: cpal + rubato FFT (anti-aliased).

use std::collections::HashSet;
use std::io::{self, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, SyncSender};
use std::sync::Arc;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample, StreamConfig};
use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Fft, FixedSync, Resampler};
use serde::Serialize;

const SAMPLE_RATE: usize = 16_000;
/// ~21 ms at 48 kHz — rubato input chunk.
const CHUNK: usize = 1024;
/// 100 ms at 16 kHz.
const FRAME: usize = 1600;
const BACKLOG: usize = 50;

#[derive(Serialize)]
struct MicJson {
    name: String,
    is_default: bool,
}

enum Event {
    Frame(Vec<i16>),
    Error(String),
}

fn main() {
    if let Err(message) = run() {
        eprintln!("{message}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let cmd = args.next().ok_or_else(usage)?;
    match cmd.as_str() {
        "list" => cmd_list(),
        "capture" => {
            let device = parse_device_flag(&mut args)?;
            cmd_capture(device)
        }
        _ => Err(usage()),
    }
}

fn usage() -> String {
    "Usage: earpop-capture list | earpop-capture capture [--device <name>]".into()
}

fn parse_device_flag(args: &mut impl Iterator<Item = String>) -> Result<Option<String>, String> {
    let mut device = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--device" => {
                let name = args
                    .next()
                    .ok_or_else(|| "Missing value for --device".to_string())?;
                if name == "default" {
                    device = None;
                } else {
                    device = Some(name);
                }
            }
            other => return Err(format!("Unknown argument: {other}")),
        }
    }
    Ok(device)
}

fn device_name(device: &cpal::Device) -> Option<String> {
    device.description().ok().map(|d| d.name().to_string())
}

fn cmd_list() -> Result<(), String> {
    let host = cpal::default_host();
    let default_name = host
        .default_input_device()
        .as_ref()
        .and_then(device_name);

    let mut seen = HashSet::new();
    let mut mics = Vec::new();
    for device in host.input_devices().map_err(text)? {
        let Some(name) = device_name(&device) else {
            continue;
        };
        if !seen.insert(name.clone()) {
            continue;
        }
        let is_default = default_name.as_ref() == Some(&name);
        mics.push(MicJson { name, is_default });
    }

    let json = serde_json::to_string(&mics).map_err(text)?;
    println!("{json}");
    Ok(())
}

fn pick_device(wanted: Option<&str>) -> Result<cpal::Device, String> {
    let host = cpal::default_host();
    if let Some(wanted) = wanted {
        let found = host
            .input_devices()
            .map_err(text)?
            .find(|device| device_name(device).as_deref() == Some(wanted));
        if let Some(device) = found {
            return Ok(device);
        }
        return Err(format!("Microphone not found: {wanted}"));
    }

    host.default_input_device().ok_or_else(|| {
        "No default input device. Check microphone connection and permission".to_string()
    })
}

fn cmd_capture(wanted: Option<String>) -> Result<(), String> {
    let stop = Arc::new(AtomicBool::new(false));
    // ctrlc: SIGINT/SIGTERM on Unix; Ctrl+C on Windows (Node SIGTERM often force-kills).
    {
        let stop = Arc::clone(&stop);
        ctrlc::set_handler(move || stop.store(true, Ordering::Relaxed)).map_err(text)?;
    }

    let device = pick_device(wanted.as_deref())?;
    let supported = device.default_input_config().map_err(text)?;
    let format = supported.sample_format();
    let config: StreamConfig = supported.config();
    let shape = Shape::new(config.sample_rate as usize, config.channels as usize)?;

    let (tx, rx) = mpsc::sync_channel::<Event>(BACKLOG);
    let stream = match format {
        SampleFormat::F32 => build::<f32>(&device, config, shape, tx.clone())?,
        SampleFormat::I16 => build::<i16>(&device, config, shape, tx.clone())?,
        SampleFormat::U16 => build::<u16>(&device, config, shape, tx.clone())?,
        SampleFormat::I32 => build::<i32>(&device, config, shape, tx.clone())?,
        SampleFormat::I8 => build::<i8>(&device, config, shape, tx.clone())?,
        other => return Err(format!("Unsupported sample format: {other}")),
    };
    stream.play().map_err(text)?;

    let mut stdout = io::stdout().lock();
    let poll = Duration::from_millis(50);

    loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        match rx.recv_timeout(poll) {
            Ok(Event::Frame(frame)) => match write_pcm(&mut stdout, &frame) {
                Ok(()) => {
                    let _ = stdout.flush();
                }
                // Node closed the pipe — clean stop (BrokenPipe; Windows may use 232).
                Err(e) if is_pipe_closed(&e) => break,
                Err(e) => return Err(text(e)),
            },
            Ok(Event::Error(message)) => return Err(message),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    drop(stream);
    Ok(())
}

fn is_pipe_closed(error: &io::Error) -> bool {
    if error.kind() == io::ErrorKind::BrokenPipe {
        return true;
    }
    // Windows ERROR_NO_DATA / broken pipe variants when the reader went away.
    matches!(error.raw_os_error(), Some(232) | Some(109))
}

fn write_pcm(out: &mut impl Write, frame: &[i16]) -> io::Result<()> {
    for &sample in frame {
        out.write_all(&sample.to_le_bytes())?;
    }
    Ok(())
}

fn build<T>(
    device: &cpal::Device,
    config: StreamConfig,
    mut shape: Shape,
    events: SyncSender<Event>,
) -> Result<cpal::Stream, String>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let errors = events.clone();
    device
        .build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                shape.push(data, |frame| {
                    let _ = events.try_send(Event::Frame(frame));
                });
            },
            move |error| {
                let message = format!("Capture stream error: {error}");
                let _ = errors.send(Event::Error(message));
            },
            None,
        )
        .map_err(text)
}

struct Shape {
    resampler: Option<Fft<f32>>,
    channels: usize,
    input: Vec<f32>,
    output: Vec<f32>,
    pending: Vec<i16>,
}

impl Shape {
    fn new(rate: usize, channels: usize) -> Result<Self, String> {
        if channels == 0 {
            return Err("Input device has no channels".into());
        }

        let resampler = if rate == SAMPLE_RATE {
            None
        } else {
            Some(Fft::<f32>::new(rate, SAMPLE_RATE, CHUNK, 1, FixedSync::Input).map_err(text)?)
        };

        let capacity = resampler
            .as_ref()
            .map(|it| it.output_frames_max())
            .unwrap_or(CHUNK);

        Ok(Self {
            resampler,
            channels,
            input: Vec::with_capacity(CHUNK * 2),
            output: vec![0.0; capacity],
            pending: Vec::with_capacity(FRAME * 2),
        })
    }

    fn push<T>(&mut self, data: &[T], mut emit: impl FnMut(Vec<i16>))
    where
        T: SizedSample,
        f32: FromSample<T>,
    {
        for frame in data.chunks_exact(self.channels) {
            let sum: f32 = frame.iter().map(|&s| f32::from_sample(s)).sum();
            self.input.push(sum / self.channels as f32);
        }

        match self.resampler.as_mut() {
            None => {
                for sample in self.input.drain(..) {
                    self.pending.push(to_i16(sample));
                }
            }
            Some(resampler) => {
                while self.input.len() >= resampler.input_frames_next() {
                    let need = resampler.input_frames_next();
                    let written = {
                        let source = match InterleavedSlice::new(&self.input[..need], 1, need) {
                            Ok(it) => it,
                            Err(e) => {
                                eprintln!("Resample input buffer invalid: {e}");
                                return;
                            }
                        };
                        let capacity = self.output.len();
                        let mut target =
                            match InterleavedSlice::new_mut(&mut self.output, 1, capacity) {
                                Ok(it) => it,
                                Err(e) => {
                                    eprintln!("Resample output buffer invalid: {e}");
                                    return;
                                }
                            };

                        match resampler.process_into_buffer(&source, &mut target, None) {
                            Ok((_read, written)) => written,
                            Err(e) => {
                                eprintln!("Resample failed: {e}");
                                return;
                            }
                        }
                    };

                    self.pending
                        .extend(self.output[..written].iter().map(|&s| to_i16(s)));
                    self.input.drain(..need);
                }
            }
        }

        while self.pending.len() >= FRAME {
            emit(self.pending.drain(..FRAME).collect());
        }
    }
}

fn to_i16(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16
}

fn text(error: impl std::fmt::Display) -> String {
    error.to_string()
}
