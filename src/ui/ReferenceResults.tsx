import { useObservable } from "../utils/UseObservable";
import { goToReference, referenceResults } from "../logic/FindAllReferences";
import { openCodeTab } from "../logic/tabs";
import { toClassFilePath } from "../utils/Names";
import { theme } from "antd";
import { searchQuery } from "../logic/State";

const ReferenceResults = () => {
    const state = useObservable(referenceResults);
    const { token } = theme.useToken();

    // Re-render the search box while a new query is being resolved.
    useObservable(searchQuery);

    const groups = state?.groups ?? [];

    return (
        <div data-testid="reference-results" style={{ padding: "8px" }}>
            {state && state.total > 0 && (
                <div data-testid="references-parsed" style={{ fontSize: "11px", color: token.colorTextTertiary, marginBottom: "6px" }}>
                    {state.analyzed}/{state.total} candidate classes parsed
                </div>
            )}
            {groups.length === 0 && state && state.analyzed > 0 && (
                <div style={{ fontSize: "12px", color: token.colorTextTertiary }}>No references found.</div>
            )}
            {groups.map(group => (
                <div key={group.className} data-testid="reference-group" style={{ marginBottom: "6px" }}>
                    <div
                        onClick={() => openCodeTab(toClassFilePath(group.className))}
                        style={{
                            cursor: "pointer",
                            fontSize: "13px",
                            fontWeight: "bold",
                            transition: "background-color 0.2s",
                            borderRadius: "4px"
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                        {group.className.split("/").pop()}
                        <span style={{ fontWeight: "normal", color: token.colorTextTertiary }}>
                            {" "}{group.className.split("/").slice(0, -1).join("/")}
                        </span>
                    </div>
                    <div style={{ paddingLeft: "16px" }}>
                        {group.references.map((reference, index) => (
                            <div
                                key={index}
                                data-testid="reference-site"
                                onClick={() => goToReference(reference)}
                                title={reference.preview}
                                style={{
                                    cursor: "pointer",
                                    fontSize: "12px",
                                    fontFamily: "monospace",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    transition: "background-color 0.2s",
                                    color: token.colorTextSecondary
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                                {reference.line + 1}: {reference.preview}
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
};

export default ReferenceResults;
