// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2019  flexiWAN Ltd.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

// Verification links last a day. Password-reset links last an hour.
// A missing issued-at does not match $gte, so those tokens fail closed.
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_PASSWORD_TTL_MS = 60 * 60 * 1000;

const verifyIssuedAtQuery = () => ({ $gte: new Date(Date.now() - VERIFY_TTL_MS) });
const resetPasswordIssuedAtQuery = () => ({ $gte: new Date(Date.now() - RESET_PASSWORD_TTL_MS) });

module.exports = {
  VERIFY_TTL_MS,
  RESET_PASSWORD_TTL_MS,
  verifyIssuedAtQuery,
  resetPasswordIssuedAtQuery
};
