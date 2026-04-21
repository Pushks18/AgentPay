use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("FkWXbUSAh2MFCBpmwbiYXpkYL2qetvDWgdM4GoHrWPP1");

pub const MIN_STAKE: u64 = 100_000_000; // 0.1 SOL
pub const SLASH_THRESHOLD: u8 = 3;
pub const MAX_SLASH_VOTERS: usize = 10;

// Burn address — nobody holds this key (all zeros except last byte).
// Sending SOL here is effectively a burn for demo purposes.
pub const BURN_ADDRESS: &str = "BurnAgntPay111111111111111111111111111111111";

const DISCRIMINATOR: usize = 8;
const PUBKEY: usize = 32;
const U64: usize = 8;
const U8: usize = 1;
const BOOL: usize = 1;
const STRING_PREFIX: usize = 4;
const MAX_NAME: usize = 32;
const VEC_PREFIX: usize = 4;

pub const STAKE_SPACE: usize =
    DISCRIMINATOR
    + PUBKEY                               // agent
    + (STRING_PREFIX + MAX_NAME)           // agent_name
    + U64                                  // amount
    + U8                                   // slash_count
    + (VEC_PREFIX + MAX_SLASH_VOTERS * PUBKEY) // slash_voters
    + BOOL                                 // active
    + U8;                                  // bump

#[program]
pub mod staking {
    use super::*;

    /// Agent stakes SOL to register. Minimum 0.1 SOL.
    pub fn stake(ctx: Context<Stake>, agent_name: String, amount: u64) -> Result<()> {
        require!(agent_name.len() <= MAX_NAME, StakingError::NameTooLong);
        require!(amount >= MIN_STAKE, StakingError::InsufficientStake);

        let agent = ctx.accounts.agent.key();
        let stake_acc = &mut ctx.accounts.stake;
        stake_acc.agent = agent;
        stake_acc.agent_name = agent_name;
        stake_acc.amount = amount;
        stake_acc.slash_count = 0;
        stake_acc.slash_voters = Vec::new();
        stake_acc.active = true;
        stake_acc.bump = ctx.bumps.stake;
        let event_agent_name = stake_acc.agent_name.clone();

        // Transfer SOL to stake PDA
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.agent.to_account_info(),
                    to: ctx.accounts.stake.to_account_info(),
                },
            ),
            amount,
        )?;

        emit!(AgentStaked {
            agent,
            agent_name: event_agent_name,
            amount,
        });

        Ok(())
    }

    /// Return stake to agent (only if not slashed and slash count < threshold).
    pub fn unstake(ctx: Context<Unstake>, _agent_name: String) -> Result<()> {
        let stake = &ctx.accounts.stake;
        require!(stake.active, StakingError::AlreadySlashed);
        require!(stake.slash_count < SLASH_THRESHOLD, StakingError::TooManySlashes);

        let amount = stake.amount;
        let seeds = &[
            b"stake",
            stake.agent.as_ref(),
            stake.agent_name.as_bytes(),
            &[stake.bump],
        ];

        // Return SOL from stake PDA to agent
        **ctx.accounts.stake.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.agent.to_account_info().try_borrow_mut_lamports()? += amount;

        emit!(AgentUnstaked {
            agent: ctx.accounts.agent.key(),
            agent_name: stake.agent_name.clone(),
            amount,
        });

        Ok(())
    }

    /// Vote to slash an agent. Accumulates votes; at SLASH_THRESHOLD, burns stake.
    pub fn vote_slash(
        ctx: Context<VoteSlash>,
        _agent_name: String,
        _job_id: [u8; 32],
        evidence: String,
    ) -> Result<()> {
        let voter = ctx.accounts.voter.key();
        let stake = &mut ctx.accounts.stake;

        require!(stake.active, StakingError::AlreadySlashed);
        require!(
            !stake.slash_voters.contains(&voter),
            StakingError::AlreadyVoted
        );
        require!(
            stake.slash_voters.len() < MAX_SLASH_VOTERS,
            StakingError::MaxVotersReached
        );

        stake.slash_voters.push(voter);
        stake.slash_count += 1;

        emit!(SlashVoteCast {
            agent: stake.agent,
            agent_name: stake.agent_name.clone(),
            voter,
            slash_count: stake.slash_count,
            evidence: evidence.clone(),
        });

        if stake.slash_count >= SLASH_THRESHOLD {
            let amount = stake.amount;
            stake.active = false;
            stake.amount = 0;
            let agent = stake.agent;
            let agent_name = stake.agent_name.clone();

            // Burn: send lamports to burn address (they stay there forever).
            **ctx.accounts.stake.to_account_info().try_borrow_mut_lamports()? -= amount;
            **ctx.accounts.burn_address.to_account_info().try_borrow_mut_lamports()? += amount;

            emit!(AgentSlashed {
                agent,
                agent_name,
                stake_burned: amount,
            });
        }

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(agent_name: String)]
pub struct Stake<'info> {
    #[account(
        init,
        payer = agent,
        space = STAKE_SPACE,
        seeds = [b"stake", agent.key().as_ref(), agent_name.as_bytes()],
        bump,
    )]
    pub stake: Account<'info, StakeAccount>,
    #[account(mut)]
    pub agent: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(agent_name: String)]
pub struct Unstake<'info> {
    #[account(
        mut,
        seeds = [b"stake", agent.key().as_ref(), agent_name.as_bytes()],
        bump = stake.bump,
        has_one = agent,
    )]
    pub stake: Account<'info, StakeAccount>,
    #[account(mut)]
    pub agent: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(agent_name: String)]
pub struct VoteSlash<'info> {
    #[account(
        mut,
        seeds = [b"stake", stake.agent.as_ref(), agent_name.as_bytes()],
        bump = stake.bump,
    )]
    pub stake: Account<'info, StakeAccount>,
    #[account(mut)]
    pub voter: Signer<'info>,
    /// CHECK: burn address — validated by constraint
    #[account(
        mut,
        constraint = burn_address.key().to_string() == BURN_ADDRESS @ StakingError::InvalidBurnAddress
    )]
    pub burn_address: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
pub struct StakeAccount {
    pub agent: Pubkey,
    pub agent_name: String,
    pub amount: u64,
    pub slash_count: u8,
    pub slash_voters: Vec<Pubkey>,
    pub active: bool,
    pub bump: u8,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct AgentStaked {
    pub agent: Pubkey,
    pub agent_name: String,
    pub amount: u64,
}

#[event]
pub struct AgentUnstaked {
    pub agent: Pubkey,
    pub agent_name: String,
    pub amount: u64,
}

#[event]
pub struct SlashVoteCast {
    pub agent: Pubkey,
    pub agent_name: String,
    pub voter: Pubkey,
    pub slash_count: u8,
    pub evidence: String,
}

#[event]
pub struct AgentSlashed {
    pub agent: Pubkey,
    pub agent_name: String,
    pub stake_burned: u64,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum StakingError {
    #[msg("Name must be 32 characters or fewer")]
    NameTooLong,
    #[msg("Minimum stake is 0.1 SOL (100,000,000 lamports)")]
    InsufficientStake,
    #[msg("Agent has already been slashed")]
    AlreadySlashed,
    #[msg("Too many slashes — unstake unavailable")]
    TooManySlashes,
    #[msg("Voter has already cast a slash vote for this agent")]
    AlreadyVoted,
    #[msg("Maximum slash voters reached")]
    MaxVotersReached,
    #[msg("Invalid burn address")]
    InvalidBurnAddress,
}
