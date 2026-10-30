// Reserve headroom below the observed Render 2 GiB temporary-volume limit.
// SQLite VACUUM may need another full database while the first copy exists.
export function canCompactSnapshot(bytes,available){return Number.isSafeInteger(bytes)&&bytes>=0&&Number.isFinite(available)&&available>=bytes+128*1024*1024&&2*bytes+128*1024*1024<2*1024*1024*1024;}
