import { openSync, readSync, closeSync, fstatSync } from 'fs';
import { LIMITS, cap } from './limits.js';

function readNullString(buf, pos) {
  let end = pos.i;
  while (end < buf.length && buf[end] !== 0) end++;
  const s = buf.toString('latin1', pos.i, end);
  pos.i = end + 1;
  return s;
}

export function indexVPK(dirPath, filter) {
  const fd = openSync(dirPath, 'r');
  try {
    const head = Buffer.alloc(28);
    readSync(fd, head, 0, 28, 0);
    if (head.readUInt32LE(0) !== 0x55aa1234) throw new Error('not a VPK');
    const version = head.readUInt32LE(4);
    const treeSize = head.readUInt32LE(8);
    const headerSize = version === 2 ? 28 : 12;
    cap(treeSize, Math.min(LIMITS.vpkTree, Math.max(0, fstatSync(fd).size - headerSize)), 'vpk tree size');
    const tree = Buffer.alloc(treeSize);
    readSync(fd, tree, 0, treeSize, headerSize);

    const entries = new Map();
    const pos = { i: 0 };
    for (;;) {
      const ext = readNullString(tree, pos);
      if (!ext) break;
      for (;;) {
        const dir = readNullString(tree, pos);
        if (!dir) break;
        for (;;) {
          const name = readNullString(tree, pos);
          if (!name) break;
          if (pos.i + 18 > tree.length) return entries;
          const preloadBytes = tree.readUInt16LE(pos.i + 4);
          const archiveIndex = tree.readUInt16LE(pos.i + 6);
          const entryOffset = tree.readUInt32LE(pos.i + 8);
          const entryLength = tree.readUInt32LE(pos.i + 12);
          pos.i += 18;
          const preload = preloadBytes ? Buffer.from(tree.subarray(pos.i, pos.i + preloadBytes)) : null;
          pos.i += preloadBytes;
          if (!filter || filter(ext, dir, name)) {
            entries.set(`${dir}/${name}.${ext}`.toLowerCase(), {
              archiveIndex, entryOffset, entryLength, preload,
              dirDataOffset: headerSize + treeSize
            });
          }
        }
      }
    }
    return entries;
  } finally {
    closeSync(fd);
  }
}

export function readVPKEntry(dirPath, entry) {
  const parts = [];
  if (entry.preload) parts.push(entry.preload);
  if (entry.entryLength > 0) {
    let file = dirPath;
    let offset = entry.entryOffset;
    if (entry.archiveIndex === 0x7fff) {
      offset += entry.dirDataOffset;
    } else {
      file = dirPath.replace(/_dir\.vpk$/i, '_' + String(entry.archiveIndex).padStart(3, '0') + '.vpk');
    }
    const fd = openSync(file, 'r');
    try {
      const size = fstatSync(fd).size;
      const len = Math.min(entry.entryLength, Math.max(0, size - offset));
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, offset);
      parts.push(buf);
    } finally {
      closeSync(fd);
    }
  }
  return Buffer.concat(parts);
}
