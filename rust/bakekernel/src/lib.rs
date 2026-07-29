static mut LM: Vec<u8> = Vec::new();
static mut FACES: Vec<f64> = Vec::new();
static mut LIN: Vec<f64> = Vec::new();
static mut POWB: Vec<f64> = Vec::new();
static mut OUT: Vec<f64> = Vec::new();
static mut SRC: Vec<u8> = Vec::new();
static mut DST: Vec<u8> = Vec::new();

fn lm() -> &'static mut Vec<u8> { unsafe { &mut *(&raw mut LM) } }
fn faces() -> &'static mut Vec<f64> { unsafe { &mut *(&raw mut FACES) } }
fn lin() -> &'static mut Vec<f64> { unsafe { &mut *(&raw mut LIN) } }
fn powb() -> &'static mut Vec<f64> { unsafe { &mut *(&raw mut POWB) } }
fn out() -> &'static mut Vec<f64> { unsafe { &mut *(&raw mut OUT) } }
fn src() -> &'static mut Vec<u8> { unsafe { &mut *(&raw mut SRC) } }
fn dst() -> &'static mut Vec<u8> { unsafe { &mut *(&raw mut DST) } }

fn fit<T: Clone + Default>(v: &mut Vec<T>, n: usize) {
    if v.len() < n {
        v.resize(n, T::default());
    }
}

fn avg4(sum: u32) -> u8 {
    let q = sum >> 2;
    match sum & 3 {
        0 | 1 => q as u8,
        2 => (q + (q & 1)) as u8,
        _ => (q + 1) as u8,
    }
}

const LR: f64 = 0.2126;
const LG: f64 = 0.7152;
const LB: f64 = 0.0722;

#[no_mangle]
pub extern "C" fn lm_reserve(lm_len: usize, face_vals: usize) -> *mut u8 {
    fit(lm(), lm_len);
    fit(faces(), face_vals);
    fit(lin(), 256);
    fit(powb(), 256);
    fit(out(), 324);
    lm().as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn lm_faces_addr() -> *mut f64 { faces().as_mut_ptr() }

#[no_mangle]
pub extern "C" fn lm_lin_addr() -> *mut f64 { lin().as_mut_ptr() }

#[no_mangle]
pub extern "C" fn lm_powb_addr() -> *mut f64 { powb().as_mut_ptr() }

#[no_mangle]
pub extern "C" fn lm_out_addr() -> *mut f64 { out().as_mut_ptr() }

#[no_mangle]
pub extern "C" fn lm_stats(n_faces: usize) {
    let b = lm();
    let ft = faces();
    let tab = lin();
    let pb = powb();
    let o = out();
    for v in o.iter_mut() {
        *v = 0.0;
    }
    let mut total = 0.0f64;
    let mut scene_sum = 0.0f64;
    let mut lit = 0.0f64;
    let mut ups: Vec<f64> = Vec::new();
    for f in 0..n_faces {
        let off = ft[f * 4] as usize;
        let len = ft[f * 4 + 1] as usize;
        let albedo = ft[f * 4 + 2];
        let is_up = ft[f * 4 + 3] != 0.0;
        if len < 4 || off + len > b.len() {
            continue;
        }
        let mut up_sum = 0.0f64;
        let mut up_cnt = 0.0f64;
        let mut i = 0usize;
        while i + 2 < len {
            let p = off + i;
            let r = tab[b[p] as usize];
            let g = tab[b[p + 1] as usize];
            let bl = tab[b[p + 2] as usize];
            let l = r * LR + g * LG + bl * LB;
            let mut sl = albedo * l;
            if sl > 1.0 {
                sl = 1.0;
            }
            let mut bin = (sl * 64.0).floor() as i64;
            if bin > 63 {
                bin = 63;
            }
            if bin < 0 {
                bin = 0;
            }
            o[4 + bin as usize] += 1.0;
            total += 1.0;
            scene_sum += sl;
            if sl > 0.0005 {
                let mut lo_i = 0usize;
                let mut hi_i = 255usize;
                while lo_i < hi_i {
                    let mid = (lo_i + hi_i + 1) >> 1;
                    if pb[mid] <= sl { lo_i = mid; } else { hi_i = mid - 1; }
                }
                o[68 + lo_i] += 1.0;
                lit += 1.0;
            }
            if is_up {
                up_sum += l;
                up_cnt += 1.0;
            }
            i += 4;
        }
        if is_up && up_cnt > 0.0 {
            ups.push(up_sum / up_cnt);
        }
    }
    o[0] = total;
    o[1] = scene_sum;
    o[2] = lit;
    if ups.is_empty() {
        o[3] = 0.0;
    } else {
        ups.sort_by(|a, b| a.partial_cmp(b).unwrap_or(core::cmp::Ordering::Equal));
        let idx = ((ups.len() as f64) * 0.9).floor() as usize;
        o[3] = ups[idx.min(ups.len() - 1)];
    }
}

#[no_mangle]
pub extern "C" fn mip_reserve(src_len: usize, dst_len: usize) -> *mut u8 {
    fit(src(), src_len);
    fit(dst(), dst_len);
    src().as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn mip_dst_addr() -> *mut u8 { dst().as_mut_ptr() }

#[no_mangle]
pub extern "C" fn mip_down(sw: usize, sh: usize) {
    let s = src();
    let d = dst();
    let w = sw >> 1;
    let h = sh >> 1;
    if s.len() < sw * sh * 4 || d.len() < w * h * 4 {
        return;
    }
    let src = &s[..sw * sh * 4];
    let dst = &mut d[..w * h * 4];
    for y in 0..h {
        let row0 = (y * 2) * sw * 4;
        let row1 = row0 + sw * 4;
        let orow = y * w * 4;
        for x in 0..w {
            let s0 = row0 + x * 8;
            let s2 = row1 + x * 8;
            let o = orow + x * 4;
            for c in 0..4 {
                let sum = unsafe {
                    *src.get_unchecked(s0 + c) as u32
                        + *src.get_unchecked(s0 + 4 + c) as u32
                        + *src.get_unchecked(s2 + c) as u32
                        + *src.get_unchecked(s2 + 4 + c) as u32
                };
                unsafe { *dst.get_unchecked_mut(o + c) = avg4(sum) };
            }
        }
    }
}
