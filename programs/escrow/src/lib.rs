use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("9q8W7LG3MJFnvRwzNXLCzA74nVsPMhAbLY5FnioYCqrr");

const DISCRIMINATOR: usize = 8;
const PUBKEY: usize = 32;
const U64: usize = 8;
const I64: usize = 8;
const U8: usize = 1;
const BOOL: usize = 1;
const JOB_ID: usize = 32;
const ENUM_BYTE: usize = 1;

pub const ESCROW_SPACE: usize =
    DISCRIMINATOR + PUBKEY + PUBKEY + PUBKEY + JOB_ID + U64 + I64 + ENUM_BYTE + U8 + PUBKEY;

/// Maximum timeout callers can request (1 hour).
pub const MAX_TIMEOUT: i64 = 3600;
/// Minimum stake to avoid dust escrows ($0.001 = 1000 USDC micro-units).
pub const MIN_AMOUNT: u64 = 1_000;

#[program]
pub mod escrow {
    use super::*;

    /// Lock USDC in an escrow PDA. Transfers `amount` from buyer's ATA to vault.
    pub fn create_escrow(
        ctx: Context<CreateEscrow>,
        job_id: [u8; 32],
        amount: u64,
        timeout_seconds: i64,
    ) -> Result<()> {
        require!(amount >= MIN_AMOUNT, EscrowError::AmountTooSmall);
        let timeout = timeout_seconds.min(MAX_TIMEOUT).max(30);

        let escrow = &mut ctx.accounts.escrow;
        escrow.buyer = ctx.accounts.buyer.key();
        escrow.seller = ctx.accounts.seller.key();
        escrow.arbitrator = ctx.accounts.arbitrator.key();
        escrow.job_id = job_id;
        escrow.amount = amount;
        escrow.deadline = Clock::get()?.unix_timestamp + timeout;
        escrow.status = EscrowStatus::Locked;
        escrow.bump = ctx.bumps.escrow;
        escrow.vault = ctx.accounts.vault.key();

        // Transfer USDC from buyer to vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            amount,
        )?;

        emit!(EscrowCreated {
            job_id,
            buyer: escrow.buyer,
            seller: escrow.seller,
            amount,
            deadline: escrow.deadline,
        });

        Ok(())
    }

    /// Release USDC to seller. Callable by buyer or anyone after deadline.
    pub fn release_payment(ctx: Context<SettleEscrow>, job_id: [u8; 32]) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require!(
            escrow.status == EscrowStatus::Locked,
            EscrowError::InvalidStatus
        );
        let amount = escrow.amount;

        let is_buyer = ctx.accounts.authority.key() == escrow.buyer;
        let deadline_passed = Clock::get()?.unix_timestamp >= escrow.deadline;
        require!(is_buyer || deadline_passed, EscrowError::Unauthorized);

        let seeds = &[
            b"escrow",
            escrow.buyer.as_ref(),
            &job_id,
            &[escrow.bump],
        ];
        let signer = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.recipient_token.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        ctx.accounts.escrow.status = EscrowStatus::Released;

        emit!(EscrowReleased {
            job_id,
            amount,
        });

        Ok(())
    }

    /// Refund USDC to buyer before deadline.
    pub fn refund(ctx: Context<SettleEscrow>, job_id: [u8; 32]) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require!(
            escrow.status == EscrowStatus::Locked,
            EscrowError::InvalidStatus
        );
        let amount = escrow.amount;
        require!(
            ctx.accounts.authority.key() == escrow.buyer,
            EscrowError::Unauthorized
        );
        require!(
            Clock::get()?.unix_timestamp < escrow.deadline,
            EscrowError::DeadlinePassed
        );

        let seeds = &[
            b"escrow",
            escrow.buyer.as_ref(),
            &job_id,
            &[escrow.bump],
        ];
        let signer = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.recipient_token.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        ctx.accounts.escrow.status = EscrowStatus::Refunded;

        emit!(EscrowRefunded {
            job_id,
            amount,
        });

        Ok(())
    }

    /// Raise a dispute — pauses the escrow. Buyer or seller can call.
    pub fn raise_dispute(ctx: Context<RaiseDispute>, _job_id: [u8; 32], reason: String) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.status == EscrowStatus::Locked,
            EscrowError::InvalidStatus
        );
        let caller = ctx.accounts.caller.key();
        require!(
            caller == escrow.buyer || caller == escrow.seller,
            EscrowError::Unauthorized
        );

        escrow.status = EscrowStatus::Disputed;

        emit!(DisputeRaised {
            job_id: escrow.job_id,
            raised_by: caller,
            reason,
        });

        Ok(())
    }

    /// Arbitrator resolves dispute — sends to seller or refunds buyer.
    pub fn resolve_dispute(
        ctx: Context<ResolveDispute>,
        job_id: [u8; 32],
        release_to_seller: bool,
    ) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require!(
            escrow.status == EscrowStatus::Disputed,
            EscrowError::InvalidStatus
        );
        require!(
            ctx.accounts.arbitrator.key() == escrow.arbitrator,
            EscrowError::Unauthorized
        );

        let seeds = &[
            b"escrow",
            escrow.buyer.as_ref(),
            &job_id,
            &[escrow.bump],
        ];
        let signer = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.recipient_token.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                signer,
            ),
            escrow.amount,
        )?;

        ctx.accounts.escrow.status = EscrowStatus::Resolved;

        emit!(DisputeResolved {
            job_id,
            release_to_seller,
        });

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Account contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(job_id: [u8; 32])]
pub struct CreateEscrow<'info> {
    #[account(
        init,
        payer = buyer,
        space = ESCROW_SPACE,
        seeds = [b"escrow", buyer.key().as_ref(), &job_id],
        bump,
    )]
    pub escrow: Account<'info, Escrow>,

    /// Vault: ATA owned by the escrow PDA — holds USDC during lock.
    #[account(
        init,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = escrow,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut, associated_token::mint = mint, associated_token::authority = buyer)]
    pub buyer_token: Account<'info, TokenAccount>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: just stored as address, not validated on-chain
    pub seller: UncheckedAccount<'info>,

    /// CHECK: arbitrator address stored for future dispute resolution
    pub arbitrator: UncheckedAccount<'info>,

    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 32])]
pub struct SettleEscrow<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), &job_id],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = escrow,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Recipient gets the USDC (seller on release, buyer on refund).
    #[account(mut)]
    pub recipient_token: Account<'info, TokenAccount>,

    pub authority: Signer<'info>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 32])]
pub struct RaiseDispute<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), &job_id],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, Escrow>,
    pub caller: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 32])]
pub struct ResolveDispute<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), &job_id],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = escrow,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub recipient_token: Account<'info, TokenAccount>,

    pub arbitrator: Signer<'info>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ---------------------------------------------------------------------------
// State + enums
// ---------------------------------------------------------------------------

#[account]
pub struct Escrow {
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub arbitrator: Pubkey,
    pub job_id: [u8; 32],
    pub amount: u64,
    pub deadline: i64,
    pub status: EscrowStatus,
    pub bump: u8,
    pub vault: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum EscrowStatus {
    Locked,
    Released,
    Refunded,
    Disputed,
    Resolved,
}

impl Default for EscrowStatus {
    fn default() -> Self {
        EscrowStatus::Locked
    }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct EscrowCreated {
    pub job_id: [u8; 32],
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub amount: u64,
    pub deadline: i64,
}

#[event]
pub struct EscrowReleased {
    pub job_id: [u8; 32],
    pub amount: u64,
}

#[event]
pub struct EscrowRefunded {
    pub job_id: [u8; 32],
    pub amount: u64,
}

#[event]
pub struct DisputeRaised {
    pub job_id: [u8; 32],
    pub raised_by: Pubkey,
    pub reason: String,
}

#[event]
pub struct DisputeResolved {
    pub job_id: [u8; 32],
    pub release_to_seller: bool,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum EscrowError {
    #[msg("Amount too small — minimum is 1000 USDC micro-units")]
    AmountTooSmall,
    #[msg("Invalid escrow status for this operation")]
    InvalidStatus,
    #[msg("Unauthorized caller")]
    Unauthorized,
    #[msg("Deadline has already passed")]
    DeadlinePassed,
}
