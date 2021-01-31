import dateFormat from "dateformat";
import { table, getBorderCharacters } from "table";
import config from "./config.js";

const eventDate = (event) => {
    return `${dateFormat(event.date, "ddd mmm dd yyyy HH:MM:ss Z")} ([Convert](https://timee.io/${dateFormat(event.date, "yyyymmdd'T'HHMM")}?tl=${encodeURIComponent(event.clean_text)}))`
}

const eventDateShort = (event) => {
    return `${dateFormat(event.date, "dd/mm/yyyy HH:MM Z")}`
}

const eventMessage = (event, attendees, unavail, tentative) => {
    let fields = [{
        name: "Time of Event",
        value: eventDate(event),
    },]
    if (attendees != "") {
        fields.push({ name: "Available", value: attendees })
    }
    if (unavail != "") {
        fields.push({ name: "Unavailable", value: unavail })
    }
    if (tentative != "") {
        fields.push({ name: "Tentative", value: tentative })
    }
    return {
        embed: {
            color: 3447003,
            title: `${event.id ? `#${event.id} ` : ""}${event.clean_text}`,
            fields: fields,
            footer: {
                text: `${config.YES_EMOJI}: available ${config.NO_EMOJI}: unavailable ${config.TENTATIVE_EMOJI}: tentative ${config.EXIT_EMOJI}: delete`,
            },
        }
    }
}

const listEventsMessage = (events) => {
    let mEvents = events.map(e => ([e.clean_text.length === 0 ? "<no title>" : e.clean_text, `#${e.id}`, eventDateShort(e)]))
    let output;

    if (mEvents.length === 0) {
        return "No events in this server"
    }

    output = table(mEvents, {
        border: getBorderCharacters(`void`),
        columnDefault: {
            paddingLeft: 0,
            paddingRight: 1
        },
        drawHorizontalLine: () => {
            return false
        }
    });
    return {
        embed: {
            color: 3447003,
            title: "Scheduled Events",
            description: `\`\`\`${output}\`\`\``,
        }
    }
}

const notificationMessage = (title, date, attendees) => {
    let attendee_text = ""
    if (attendees != "") {
        attendee_text = `${attendees}: `
    }
    return `${attendee_text}${title.length === 0 ? "<no title>" : title}`
}

export { eventMessage, listEventsMessage, notificationMessage };
