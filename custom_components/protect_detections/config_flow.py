"""One-click setup: uses the existing UniFi Protect integration's connection."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback

from . import CONF_RECORD, DOMAIN, _protect_api, zones_installed


class ProtectDetectionsFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return ProtectDetectionsOptions()

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if not zones_installed():
            return self.async_abort(reason="zones_not_installed")
        if _protect_api(self.hass) is None:
            return self.async_abort(reason="protect_not_loaded")
        if user_input is None:
            return self.async_show_form(step_id="user")
        return self.async_create_entry(title="Protect Detections", data={})


class ProtectDetectionsOptions(OptionsFlow):
    """What can be turned off: the always-on record of live sightings."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        now = self.config_entry.options.get(CONF_RECORD, True)
        return self.async_show_form(
            step_id="init", data_schema=vol.Schema({vol.Required(CONF_RECORD, default=now): bool})
        )
