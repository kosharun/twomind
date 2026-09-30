package de.bitconex.negotiation;

public class NegotiationService {
    private final NegotiationRepository repository;

    public NegotiationService(NegotiationRepository repository) {
        this.repository = repository;
    }

    public Negotiation findById(Long id) {
        validate(id);
        return repository.findById(id);
    }

    private void validate(Long id) {
        if (id == null) {
            throw new IllegalArgumentException("id");
        }
    }
}
