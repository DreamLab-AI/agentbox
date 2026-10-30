//! Validate the decoded clock and held padding of conditioning video.
use crate::clock::RationalRate;
use serde_json::{Value, json};
use std::{error::Error, path::Path, process::Command};

fn output(command: &mut Command) -> Result<Vec<u8>, Box<dyn Error>> {
    let result = command.output()?;
    if !result.status.success() {
        return Err(String::from_utf8_lossy(&result.stderr).into_owned().into());
    }
    Ok(result.stdout)
}

/// Decode a guide, check its frame count/rate, and require all padding to repeat
/// the last delivery frame. This detects a next-shot frame accidentally read
/// before `tpad` from an untrimmed render directory. It does not compare the
/// delivery pictures to their source world or prove image/physical conformance.
pub fn check_video_padding(
    path: &Path,
    delivery: u32,
    model: u32,
    rate: RationalRate,
) -> Result<Value, Box<dyn Error>> {
    if delivery == 0 || model < delivery {
        return Err("invalid delivery/model count or frame rate".into());
    }
    let bytes = output(
        Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-count_frames",
                "-show_entries",
                "stream=width,height,r_frame_rate,nb_read_frames,duration",
                "-of",
                "json",
            ])
            .arg(path),
    )?;
    let probe = serde_json::from_slice::<Value>(&bytes)?["streams"][0].clone();
    let count = probe["nb_read_frames"]
        .as_str()
        .and_then(|value| value.parse::<u32>().ok());
    if !probe["r_frame_rate"]
        .as_str()
        .is_some_and(|r| rate.matches_probe(r))
        || count != Some(model)
    {
        return Err("guide decoded clock/frame count differs".into());
    }
    crate::media::probe(path)?.require_upright_square()?;
    let hash_bytes = output(
        Command::new("ffmpeg")
            .args(["-nostdin", "-v", "error", "-i"])
            .arg(path)
            .args(["-map", "0:v:0", "-f", "framehash", "-hash", "sha256", "-"]),
    )?;
    let text = String::from_utf8(hash_bytes)?;
    let hashes: Vec<_> = text
        .lines()
        .filter(|line| !line.starts_with('#'))
        .filter_map(|line| line.rsplit_once(',').map(|(_, hash)| hash.trim()))
        .collect();
    if hashes.len() != model as usize || hashes.iter().any(|hash| hash.len() != 64) {
        return Err("unexpected decoded frame-hash output".into());
    }
    let tail = &hashes[delivery as usize - 1..];
    if tail.iter().any(|hash| *hash != tail[0]) {
        return Err("guide padding contains another frame instead of the held end pose".into());
    }
    Ok(
        json!({"rate":rate,"delivery_frames":delivery,"model_frames":model,
        "padding_frames":model-delivery,"decoded_frames_checked":hashes.len(),
        "last_delivery_and_padding_sha256":tail,"padding_hold_verified":true,"probe":probe}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn real_next_shot_frames_are_rejected_then_trimmed_padding_passes() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("guide-padding-{}-{nonce}", std::process::id()));
        std::fs::create_dir(&dir).unwrap();
        let wrong = dir.join("next-shot.mkv");
        output(Command::new("ffmpeg").args(["-nostdin","-v","error","-f","lavfi","-i",
            "color=c=red:s=16x16:r=25:d=0.12[r];color=c=blue:s=16x16:r=25:d=0.08[b];[r][b]concat=n=2:v=1:a=0",
            "-frames:v","5","-c:v","ffv1","-threads","1"]).arg(&wrong)).unwrap();
        assert!(
            check_video_padding(&wrong, 3, 5, RationalRate::new(25, 1).unwrap())
                .unwrap_err()
                .to_string()
                .contains("padding")
        );
        let fixed = dir.join("held.mkv");
        output(
            Command::new("ffmpeg")
                .args(["-nostdin", "-v", "error", "-i"])
                .arg(&wrong)
                .args([
                    "-vf",
                    "trim=end_frame=3,tpad=stop_mode=clone:stop=2",
                    "-frames:v",
                    "5",
                    "-c:v",
                    "ffv1",
                    "-threads",
                    "1",
                ])
                .arg(&fixed),
        )
        .unwrap();
        assert_eq!(
            check_video_padding(&fixed, 3, 5, RationalRate::new(25, 1).unwrap()).unwrap()["padding_hold_verified"],
            true
        );
        assert!(check_video_padding(&fixed, 3, 5, RationalRate::new(24, 1).unwrap()).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
