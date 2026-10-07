# Creator affinity

Radio LAN's affinity panel derives suggestions from the visitor's browser follow list and the current curated channel board. A followed channel contributes an interest only when the board has its Twitch login and a category observation for it. Suggestions are other known board channels in those same categories, ordered by how many of the visitor's followed channels share that category.

This is a local category match. It does not compare visitors, identify similar fans, or use viewing counts as a score. Category labels come from the board and carry its `Data: Twitch` attribution. Browser follows stay in local storage and are not sent to the hub API.

When OAuth is configured, the server may read a user's Twitch follows once with the transient `user:read:follows` access token. That read is limited to the curated registry, returns known slugs only, and does not save the token or Twitch follow list. The browser category panel remains useful when OAuth is unavailable. Preview data must display the `Sample` tag.
