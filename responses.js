const eventMessage = (title, date, attendees) => {
    let attendee_list = attendees
    if (attendees === "") {
        attendee_list = "none"
    }
    return {
        embed: {
            color: 3447003,
            title: title,
            fields: [{
                name: "Time of Event",
                value: date,
            },
            {
                name: "Attendees",
                value: attendee_list,
            },
            ],
            timestamp: new Date(),
        }
    }
}

const notificationMessage = (title, date, attendees) => {
    return `${attendees}: ${title}`
}

export { eventMessage, notificationMessage };