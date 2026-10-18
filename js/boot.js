// Boot: start the page
//
// The last file, so everything above exists before anything runs.

// Pick up an existing session so a refresh doesn't mean signing in again.
db.auth.getSession().then(({ data }) => { if (data.session) start(); });
