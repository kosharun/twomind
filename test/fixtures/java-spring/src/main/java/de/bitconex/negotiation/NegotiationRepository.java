package de.bitconex.negotiation;

public class NegotiationRepository {
    public Negotiation findById(Long id) {
        return new Negotiation(id);
    }
}
