/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

export enum Permission {
    SESSION_ESTABLISHED               =  0x10,
    // NORMAL_PERMISSIONS                =  0x20,
    ADMIN_PERMISSIONS                 =  0x40,
    ALLOW_WITH_MAINTENANCE            =  0x80,
    HAS_ANY_SESSION                  = 0x1000,
    USER_SESSION                     = 0x2000
}