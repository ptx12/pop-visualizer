const RGBA8888: i32 = 0;
const ABGR8888: i32 = 1;
const RGB888: i32 = 2;
const BGR888: i32 = 3;
const I8: i32 = 5;
const IA88: i32 = 6;
const A8: i32 = 8;
const ARGB8888: i32 = 11;
const BGRA8888: i32 = 12;
const DXT1: i32 = 13;
const DXT3: i32 = 14;
const DXT5: i32 = 15;
const BGRX8888: i32 = 16;
const DXT1A: i32 = 20;

fn bytes_per_pixel(fmt: i32) -> usize {
    match fmt {
        RGBA8888 | ABGR8888 | ARGB8888 | BGRA8888 | BGRX8888 => 4,
        RGB888 | BGR888 => 3,
        IA88 => 2,
        I8 | A8 => 1,
        _ => 0,
    }
}

fn decode565(c: u16) -> [u32; 3] {
    [
        ((c >> 11) as u32 & 31) * 255 / 31,
        ((c >> 5) as u32 & 63) * 255 / 63,
        (c as u32 & 31) * 255 / 31,
    ]
}

fn rd_u16(src: &[u8], off: usize) -> u16 {
    u16::from_le_bytes([src[off], src[off + 1]])
}

fn rd_u32(src: &[u8], off: usize) -> u32 {
    u32::from_le_bytes([src[off], src[off + 1], src[off + 2], src[off + 3]])
}

fn decode_dxt_color(
    src: &[u8],
    off: usize,
    out: &mut [u8],
    w: usize,
    h: usize,
    bx: usize,
    by: usize,
    alpha_from_dxt1: bool,
) {
    let c0 = rd_u16(src, off);
    let c1 = rd_u16(src, off + 2);
    let bits = rd_u32(src, off + 4);
    let p0 = decode565(c0);
    let p1 = decode565(c1);
    let mut pal = [[0u32; 3]; 4];
    pal[0] = p0;
    pal[1] = p1;
    if c0 > c1 || !alpha_from_dxt1 {
        for i in 0..3 {
            pal[2][i] = (2 * p0[i] + p1[i]) / 3;
            pal[3][i] = (p0[i] + 2 * p1[i]) / 3;
        }
    } else {
        for i in 0..3 {
            pal[2][i] = (p0[i] + p1[i]) / 2;
            pal[3][i] = 0;
        }
    }
    for py in 0..4usize {
        for px in 0..4usize {
            let x = bx + px;
            let y = by + py;
            if x >= w || y >= h {
                continue;
            }
            let idx = ((bits >> ((py * 4 + px) * 2)) & 3) as usize;
            let o = (y * w + x) * 4;
            out[o] = pal[idx][0] as u8;
            out[o + 1] = pal[idx][1] as u8;
            out[o + 2] = pal[idx][2] as u8;
            if alpha_from_dxt1 {
                out[o + 3] = if idx == 3 && !(c0 > c1) { 0 } else { 255 };
            }
        }
    }
}

fn decode_dxt5_alpha(src: &[u8], off: usize, out: &mut [u8], w: usize, h: usize, bx: usize, by: usize) {
    let a0 = src[off] as u32;
    let a1 = src[off + 1] as u32;
    let mut pal = [0u32; 8];
    pal[0] = a0;
    pal[1] = a1;
    if a0 > a1 {
        for i in 1..7usize {
            pal[i + 1] = ((7 - i as u32) * a0 + i as u32 * a1) / 7;
        }
    } else {
        for i in 1..5usize {
            pal[i + 1] = ((5 - i as u32) * a0 + i as u32 * a1) / 5;
        }
        pal[6] = 0;
        pal[7] = 255;
    }
    let lo = rd_u32(src, off + 2);
    let hi = rd_u16(src, off + 6) as u32;
    for i in 0..16usize {
        let code = if i < 10 {
            (lo >> (i * 3)) & 7
        } else if i == 10 {
            ((lo >> 30) | (hi << 2)) & 7
        } else {
            (hi >> (i * 3 - 32)) & 7
        };
        let x = bx + (i % 4);
        let y = by + (i / 4);
        if x >= w || y >= h {
            continue;
        }
        out[(y * w + x) * 4 + 3] = pal[code as usize] as u8;
    }
}

fn decode_dxt3_alpha(src: &[u8], off: usize, out: &mut [u8], w: usize, h: usize, bx: usize, by: usize) {
    for i in 0..16usize {
        let nib = (src[off + (i >> 1)] >> ((i & 1) * 4)) & 15;
        let x = bx + (i % 4);
        let y = by + (i / 4);
        if x >= w || y >= h {
            continue;
        }
        out[(y * w + x) * 4 + 3] = nib * 17;
    }
}

static mut SRC: Vec<u8> = Vec::new();
static mut OUT: Vec<u8> = Vec::new();

fn src_buf() -> &'static mut Vec<u8> {
    unsafe { &mut *(&raw mut SRC) }
}

fn out_buf() -> &'static mut Vec<u8> {
    unsafe { &mut *(&raw mut OUT) }
}

#[no_mangle]
pub extern "C" fn reserve(src_len: usize, out_len: usize) -> *mut u8 {
    let s = src_buf();
    if s.len() < src_len {
        s.resize(src_len, 0);
    }
    let o = out_buf();
    if o.len() < out_len {
        o.resize(out_len, 0);
    }
    s.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn out_addr() -> *mut u8 {
    out_buf().as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn decode_image(src_len: usize, off: usize, w: usize, h: usize, fmt: i32) -> i32 {
    if w == 0 || h == 0 {
        return 0;
    }
    let out_len = w * h * 4;
    if src_buf().len() < src_len || out_buf().len() < out_len {
        return 0;
    }
    let src: &[u8] = &src_buf()[..src_len];
    let out: &mut [u8] = &mut out_buf()[..out_len];
    for v in out.iter_mut() {
        *v = 255;
    }

    if fmt == DXT1 || fmt == DXT1A || fmt == DXT3 || fmt == DXT5 {
        let bw = ((w + 3) / 4).max(1);
        let bh = ((h + 3) / 4).max(1);
        let block = if fmt == DXT1 || fmt == DXT1A { 8usize } else { 16usize };
        let mut p = off;
        for by in 0..bh {
            for bx in 0..bw {
                if p + block > src_len {
                    return 1;
                }
                if fmt == DXT5 {
                    decode_dxt5_alpha(src, p, out, w, h, bx * 4, by * 4);
                    decode_dxt_color(src, p + 8, out, w, h, bx * 4, by * 4, false);
                } else if fmt == DXT3 {
                    decode_dxt3_alpha(src, p, out, w, h, bx * 4, by * 4);
                    decode_dxt_color(src, p + 8, out, w, h, bx * 4, by * 4, false);
                } else {
                    decode_dxt_color(src, p, out, w, h, bx * 4, by * 4, true);
                }
                p += block;
            }
        }
        return 1;
    }

    let bpp = bytes_per_pixel(fmt);
    if bpp == 0 {
        return 0;
    }
    for i in 0..(w * h) {
        let s = off + i * bpp;
        if s + bpp > src_len {
            break;
        }
        let d = i * 4;
        match fmt {
            RGBA8888 => {
                out[d] = src[s];
                out[d + 1] = src[s + 1];
                out[d + 2] = src[s + 2];
                out[d + 3] = src[s + 3];
            }
            ABGR8888 => {
                out[d] = src[s + 3];
                out[d + 1] = src[s + 2];
                out[d + 2] = src[s + 1];
                out[d + 3] = src[s];
            }
            ARGB8888 => {
                out[d] = src[s + 1];
                out[d + 1] = src[s + 2];
                out[d + 2] = src[s + 3];
                out[d + 3] = src[s];
            }
            BGRA8888 => {
                out[d] = src[s + 2];
                out[d + 1] = src[s + 1];
                out[d + 2] = src[s];
                out[d + 3] = src[s + 3];
            }
            BGRX8888 => {
                out[d] = src[s + 2];
                out[d + 1] = src[s + 1];
                out[d + 2] = src[s];
            }
            RGB888 => {
                out[d] = src[s];
                out[d + 1] = src[s + 1];
                out[d + 2] = src[s + 2];
            }
            BGR888 => {
                out[d] = src[s + 2];
                out[d + 1] = src[s + 1];
                out[d + 2] = src[s];
            }
            I8 => {
                out[d] = src[s];
                out[d + 1] = src[s];
                out[d + 2] = src[s];
            }
            IA88 => {
                out[d] = src[s];
                out[d + 1] = src[s];
                out[d + 2] = src[s];
                out[d + 3] = src[s + 1];
            }
            A8 => {
                out[d] = 255;
                out[d + 1] = 255;
                out[d + 2] = 255;
                out[d + 3] = src[s];
            }
            _ => {}
        }
    }
    1
}
