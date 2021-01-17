import dateFormat from "dateformat";
import config from "./config.js";

const eventMessage = (title, date, attendees, unavail) => {
    let attendee_list = attendees
    let unavail_list = unavail
    if (attendees === "") {
        attendee_list = "none"
    }
    if (unavail === "") {
        unavail_list = "none"
    }
    return {
        embed: {
            color: 3447003,
            title: title,
            fields: [{
                name: "Time of Event",
                value: `${dateFormat(date, "ddd mmm dd yyyy HH:MM:ss Z")} ([Convert](https://timee.io/${dateFormat(date, "yyyymmdd'T'HHMM")}?tl=${encodeURIComponent(title)}))`,
            },
            {
                name: "Attendees",
                value: attendee_list,
            },
            {
                name: "Unavailable",
                value: unavail_list,
            }
            ],
            footer: {
                text: `${config.YES_EMOJI}: available ${config.NO_EMOJI}: unavailable ${config.EXIT_EMOJI}: delete`,
            },
        }
    }
}

const notificationMessage = (title, date, attendees) => {
    return `${attendees}: ${title}`
}

export { eventMessage, notificationMessage };
