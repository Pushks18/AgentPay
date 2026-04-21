use anchor_lang::prelude::*;

declare_id!("FtBmcT3US3GM9hE98qZL2vGpayxU795c9YrxwTZepHM9");

// Space constants
const DISCRIMINATOR: usize = 8;
const PUBKEY: usize = 32;
const U64: usize = 8;
const I64: usize = 8;
const BOOL: usize = 1;
const U8: usize = 1;
const STRING_PREFIX: usize = 4;
const MAX_NAME: usize = 32;
const MAX_SERVICE: usize = 32;
const MAX_ENDPOINT: usize = 128;

pub const AGENT_SPACE: usize =
    DISCRIMINATOR + PUBKEY + (STRING_PREFIX + MAX_NAME) + (STRING_PREFIX + MAX_SERVICE)
    + (STRING_PREFIX + MAX_ENDPOINT) + U64 + U64 + U64 + BOOL + I64 + U8;

#[program]
pub mod agent_registry {
    use super::*;

    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        name: String,
        service: String,
        endpoint: String,
        price: u64,
    ) -> Result<()> {
        require!(name.len() <= MAX_NAME, RegistryError::NameTooLong);
        require!(service.len() <= MAX_SERVICE, RegistryError::ServiceTooLong);
        require!(endpoint.len() <= MAX_ENDPOINT, RegistryError::EndpointTooLong);
        require!(price > 0, RegistryError::InvalidPrice);

        let agent = &mut ctx.accounts.agent;
        agent.owner = ctx.accounts.owner.key();
        agent.name = name.clone();
        agent.service = service.clone();
        agent.endpoint = endpoint;
        agent.price = price;
        agent.reputation = 0;
        agent.total_jobs = 0;
        agent.active = true;
        agent.registered_at = Clock::get()?.unix_timestamp;
        agent.bump = ctx.bumps.agent;

        emit!(AgentRegistered {
            agent: agent.key(),
            name,
            service,
            price,
        });

        Ok(())
    }

    pub fn deregister_agent(ctx: Context<MutateAgent>, _name: String) -> Result<()> {
        let agent = &mut ctx.accounts.agent;
        agent.active = false;

        emit!(AgentDeregistered {
            agent: agent.key(),
            name: agent.name.clone(),
        });

        Ok(())
    }

    pub fn update_price(ctx: Context<MutateAgent>, _name: String, new_price: u64) -> Result<()> {
        require!(new_price > 0, RegistryError::InvalidPrice);
        ctx.accounts.agent.price = new_price;
        Ok(())
    }

    /// Called by the staking program (or admin) to slash/deactivate an agent.
    pub fn set_active(ctx: Context<MutateAgent>, _name: String, active: bool) -> Result<()> {
        ctx.accounts.agent.active = active;
        Ok(())
    }

    pub fn increment_reputation(ctx: Context<MutateAgent>, _name: String, delta: u64) -> Result<()> {
        let agent = &mut ctx.accounts.agent;
        agent.reputation = agent.reputation.saturating_add(delta);
        agent.total_jobs = agent.total_jobs.saturating_add(1);
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(name: String)]
pub struct RegisterAgent<'info> {
    #[account(
        init,
        payer = owner,
        space = AGENT_SPACE,
        seeds = [b"agent", owner.key().as_ref(), name.as_bytes()],
        bump,
    )]
    pub agent: Account<'info, Agent>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(name: String)]
pub struct MutateAgent<'info> {
    #[account(
        mut,
        seeds = [b"agent", owner.key().as_ref(), name.as_bytes()],
        bump = agent.bump,
        has_one = owner,
    )]
    pub agent: Account<'info, Agent>,
    pub owner: Signer<'info>,
}

#[account]
pub struct Agent {
    pub owner: Pubkey,
    pub name: String,
    pub service: String,
    pub endpoint: String,
    pub price: u64,
    pub reputation: u64,
    pub total_jobs: u64,
    pub active: bool,
    pub registered_at: i64,
    pub bump: u8,
}

#[event]
pub struct AgentRegistered {
    pub agent: Pubkey,
    pub name: String,
    pub service: String,
    pub price: u64,
}

#[event]
pub struct AgentDeregistered {
    pub agent: Pubkey,
    pub name: String,
}

#[error_code]
pub enum RegistryError {
    #[msg("Name must be 32 characters or fewer")]
    NameTooLong,
    #[msg("Service must be 32 characters or fewer")]
    ServiceTooLong,
    #[msg("Endpoint must be 128 characters or fewer")]
    EndpointTooLong,
    #[msg("Price must be greater than zero")]
    InvalidPrice,
    #[msg("Unauthorized")]
    Unauthorized,
}
