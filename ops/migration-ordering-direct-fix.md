# Supabase migration ordering repair

The complete mirror may run only after a successful production Supabase deployment. The pending schema migration must define functions and views only; runtime invoice projection and active-order-key refresh remain bounded post-deployment operations.
