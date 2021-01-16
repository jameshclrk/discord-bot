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
                value: `${dateFormat(date, "ddd mmm dd yyyy HH:MM:ss Z")} ([Convert](https://timee.io/${dateFormat(date, "yyyymmdd'T'HHMM")}?tl=${title}))`,
            },
            {
                name: "Attendees",
                value: attendee_list,
            },
            {
                name: "Unavailable",
                value: unavail_list,
            },
            {
                name: "Help",
                value: `${config.YES_EMOJI} to join\n${config.NO_EMOJI} if you can't make it\n${config.EXIT_EMOJI} to delete`,
            }],
            timestamp: new Date(),
        }
    }
}

const notificationMessage = (title, date, attendees) => {
    return `${attendees}: ${title}`
}

export { eventMessage, notificationMessage };