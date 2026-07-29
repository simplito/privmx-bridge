/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

import * as WebRtcTypes from "../webrtc/v2/WebRtcTypes";

export class JanusVideoRoomMapper {
    
    convertPublisherToPublisherAsStream(publisher: WebRtcTypes.Publisher): WebRtcTypes.PublisherAsStream {
        const {display, streams, ...rest} = publisher;
        if (!display || !streams) {
            throw new Error("convertPublisherToPublisherAsStream(): Cannot convert Janus publisher to Endpoint's stream.");
        }
        return {...rest, userId: display, tracks: streams};
    }
}
