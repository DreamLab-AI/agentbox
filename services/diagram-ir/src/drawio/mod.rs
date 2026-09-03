//! draw.io import: decode whatever draw.io wrote, flatten the `mxGraphModel`
//! into absolute-positioned nodes and edges, and report structural signals.

pub mod analyse;
pub mod decode;
pub mod digest;
pub mod model;
pub mod style;
