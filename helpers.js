const isAdmin = (user, guild) => {
    return guild.member(user).hasPermission('ADMINISTRATOR')
}

export { isAdmin };