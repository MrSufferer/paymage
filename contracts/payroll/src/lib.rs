#![no_std]

//! Payroll Contract
//!
//! Privacy-first ZK payroll on Stellar Soroban.

pub mod payroll;

#[cfg(test)]
mod test;

pub use payroll::*;
