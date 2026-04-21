use anchor_lang::prelude::*;

declare_id!("REPLACE_AFTER_anchor_keys_sync");

#[program]
pub mod agent_registry {
    use super::*;

    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        name: String,
        endpoint: String,
        price: u64,
    ) -> Result<()> {
        require!(name.len() <= 32, ErrorCode::NameTooLong);
        require!(endpoint.len() <= 128, ErrorCode::EndpointTooLong);
        let agent = &mut ctx.accounts.agent;
        agent.name = name;
        agent.endpoint = endpoint;
        agent.price = price;
        agent.owner = ctx.accounts.owner.key();
        agent.bump = ctx.bumps.agent;
        Ok(())
    }
}

#[account]
pub struct Agent {
    pub owner: Pubkey,    // 32
    pub price: u64,       // 8  (USDC micro-units, 6 decimals)
    pub name: String,     // 4 + 32
    pub endpoint: String, // 4 + 128
    pub bump: u8,         // 1
}

#[derive(Accounts)]
#[instruction(name: String)]
pub struct RegisterAgent<'info> {
    #[account(
        init, payer = owner,
        space = 8 + 32 + 8 + (4 + 32) + (4 + 128) + 1,
        seeds = [b"agent", owner.key().as_ref(), name.as_bytes()],
        bump
    )]
    pub agent: Account<'info, Agent>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Name must be 32 characters or fewer")]
    NameTooLong,
    #[msg("Endpoint must be 128 characters or fewer")]
    EndpointTooLong,
}
