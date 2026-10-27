const GITHUB_API = "https://api.github.com";

export function createGitHubClient({ token, repository }) {
  if (!token || !repository) {
    throw new Error("A GitHub token and repository name are required.");
  }

  async function request(path, options = {}) {
    const response = await fetch(`${GITHUB_API}/repos/${repository}${path}`, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${body}`);
    return body ? JSON.parse(body) : null;
  }

  return {
    addComment(issueNumber, body) {
      return request(`/issues/${issueNumber}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
    },

    updateIssueTitle(issueNumber, title) {
      return request(`/issues/${issueNumber}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
    },

    async ensureLabel(name) {
      try {
        await request("/labels", {
          method: "POST",
          body: JSON.stringify({ name, color: "ededed" }),
        });
      } catch (error) {
        // GitHub returns 422 when a label with this name already exists.
        if (!String(error.message).includes("422")) throw error;
      }
    },

    addLabels(issueNumber, labels) {
      return request(`/issues/${issueNumber}/labels`, {
        method: "POST",
        body: JSON.stringify({ labels }),
      });
    },

    lockIssue(issueNumber) {
      return request(`/issues/${issueNumber}/lock`, {
        method: "PUT",
        body: JSON.stringify({ lock_reason: "resolved" }),
      });
    },
  };
}

export function limitLabelLength(label) {
  return label.length > 50 ? `${label.slice(0, 47)}...` : label;
}
